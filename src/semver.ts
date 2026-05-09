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

/** Increment by N patch levels (used by commit-count mode). */
export function incPatchBy(version: string, n: number): string {
  const s = parseSemver(version)
  return formatSemver({
    major: s.major,
    minor: s.minor,
    patch: s.patch + n,
    prerelease: [],
    build: [],
  })
}

export function inc(version: string, level: BumpLevel): string {
  if (level === 'none') return version
  const s = parseSemver(version)
  if (level === 'major') {
    return formatSemver({ major: s.major + 1, minor: 0, patch: 0, prerelease: [], build: [] })
  }
  if (level === 'minor') {
    return formatSemver({ major: s.major, minor: s.minor + 1, patch: 0, prerelease: [], build: [] })
  }
  return formatSemver({ major: s.major, minor: s.minor, patch: s.patch + 1, prerelease: [], build: [] })
}
