/**
 * Tiny semver utilities — only what we need: parse, compare, increment.
 * Pre-release/build metadata is parsed and preserved in compare/inc only when
 * explicitly handled. Releases produced by this tool are plain X.Y.Z by design.
 */

import type { BumpLevel } from './types.js'

export interface Semver {
  major: number
  minor: number
  patch: number
  prerelease: string[]
  build: string[]
}

const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/

export function parseSemver(input: string): Semver {
  const v = input.trim().replace(/^v/, '')
  const m = SEMVER_RE.exec(v)
  if (!m) throw new Error(`Invalid semver: ${input}`)
  const [, maj, min, pat, pre, build] = m
  return {
    major: Number(maj),
    minor: Number(min),
    patch: Number(pat),
    prerelease: pre ? pre.split('.') : [],
    build: build ? build.split('.') : [],
  }
}

export function formatSemver(s: Semver): string {
  let out = `${s.major}.${s.minor}.${s.patch}`
  if (s.prerelease.length) out += `-${s.prerelease.join('.')}`
  if (s.build.length) out += `+${s.build.join('.')}`
  return out
}

export function isValidSemver(input: string): boolean {
  try {
    parseSemver(input)
    return true
  } catch {
    return false
  }
}

export function compareSemver(a: string, b: string): number {
  const A = parseSemver(a)
  const B = parseSemver(b)
  if (A.major !== B.major) return A.major - B.major
  if (A.minor !== B.minor) return A.minor - B.minor
  if (A.patch !== B.patch) return A.patch - B.patch
  // A version with prerelease has lower precedence than one without.
  if (A.prerelease.length === 0 && B.prerelease.length > 0) return 1
  if (A.prerelease.length > 0 && B.prerelease.length === 0) return -1
  for (let i = 0; i < Math.max(A.prerelease.length, B.prerelease.length); i++) {
    const ai = A.prerelease[i]
    const bi = B.prerelease[i]
    if (ai === undefined) return -1
    if (bi === undefined) return 1
    const aNum = /^\d+$/.test(ai)
    const bNum = /^\d+$/.test(bi)
    if (aNum && bNum) {
      const d = Number(ai) - Number(bi)
      if (d !== 0) return d
    } else if (aNum) {
      return -1
    } else if (bNum) {
      return 1
    } else if (ai !== bi) {
      return ai < bi ? -1 : 1
    }
  }
  return 0
}

const LEVEL_RANK: Record<BumpLevel, number> = { none: 0, patch: 1, minor: 2, major: 3 }

/** Numeric rank of a bump level, for comparisons. */
export function levelRank(level: BumpLevel): number {
  return LEVEL_RANK[level]
}

/**
 * The level a release line already represents: X.0.0 is a major, X.Y.0 a
 * minor, anything else a patch. A pre-release of 2.0.0 already "contains" a
 * major bump, so further breaking changes only advance its counter.
 */
function impliedLevel(s: Semver): BumpLevel {
  if (s.minor === 0 && s.patch === 0) return 'major'
  if (s.patch === 0) return 'minor'
  return 'patch'
}

function bumpCore(s: Semver, level: BumpLevel): Semver {
  const core = { prerelease: [] as string[], build: [] as string[] }
  if (level === 'major') return { major: s.major + 1, minor: 0, patch: 0, ...core }
  if (level === 'minor') return { major: s.major, minor: s.minor + 1, patch: 0, ...core }
  if (level === 'patch') return { major: s.major, minor: s.minor, patch: s.patch + 1, ...core }
  return { major: s.major, minor: s.minor, patch: s.patch, ...core }
}

function withPrerelease(target: Semver, current: Semver, preid: string): string {
  const sameLine =
    target.major === current.major &&
    target.minor === current.minor &&
    target.patch === current.patch
  const [id, n] = current.prerelease
  const counter =
    sameLine && id === preid && n !== undefined && /^\d+$/.test(n) ? Number(n) + 1 : 0
  return formatSemver({ ...target, prerelease: [preid, String(counter)], build: [] })
}

/** Increment by N patch levels (used by commit-count mode). */
export function incPatchBy(version: string, n: number, preid?: string): string {
  const s = parseSemver(version)
  if (s.prerelease.length > 0) {
    // N commits on top of a pre-release: advance the pre-release counter, or
    // graduate the line as-is.
    const line = { ...s, prerelease: [], build: [] }
    return preid ? withPrerelease(line, s, preid) : formatSemver(line)
  }
  const target = { ...s, patch: s.patch + n, prerelease: [], build: [] }
  return preid ? withPrerelease(target, s, preid) : formatSemver(target)
}

/**
 * Increment a version by a bump level.
 *
 * - From a stable version, bumps normally (and starts `-preid.0` if given).
 * - From a pre-release, the release line (1.3.0 for 1.3.0-beta.2) already
 *   covers bumps up to the level it implies: with a preid the counter goes up
 *   (1.3.0-beta.3), without one the line graduates (1.3.0). A bigger bump
 *   starts a new line (2.0.0-beta.0 / 2.0.0).
 */
export function inc(version: string, level: BumpLevel, preid?: string): string {
  if (level === 'none') return version
  const s = parseSemver(version)
  let target: Semver
  if (s.prerelease.length > 0) {
    const line: Semver = { ...s, prerelease: [], build: [] }
    target = levelRank(impliedLevel(line)) >= levelRank(level) ? line : bumpCore(line, level)
  } else {
    target = bumpCore(s, level)
  }
  return preid ? withPrerelease(target, s, preid) : formatSemver(target)
}
