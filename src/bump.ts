import { inc, incPatchBy, isValidSemver } from './semver.js'
import type { BumpLevel, ChangelogConfig, ParsedCommit } from './types.js'

const PRECEDENCE: Record<BumpLevel, number> = {
  none: 0,
  patch: 1,
  minor: 2,
  major: 3,
}

/** Highest of two bump levels. */
export function maxBump(a: BumpLevel, b: BumpLevel): BumpLevel {
  return PRECEDENCE[a] >= PRECEDENCE[b] ? a : b
}

/**
 * Determine the bump level implied by a set of commits under semver rules.
 * Breaking changes always escalate to 'major'.
 */
export function deriveSemverBump(
  commits: ParsedCommit[],
  bumpMap: Record<string, BumpLevel>,
): BumpLevel {
  let level: BumpLevel = 'none'
  for (const c of commits) {
    if (c.breaking) {
      level = maxBump(level, 'major')
      continue
    }
    const mapped = bumpMap[c.type] ?? 'none'
    level = maxBump(level, mapped)
  }
  return level
}

export interface ComputeNextVersionResult {
  next: string
  level: BumpLevel
}

/**
 * Compute the next version given the current version, the commits since it,
 * and the config. Returns level='none' (and next === current) if no release.
 */
export function computeNextVersion(
  currentVersion: string,
  commits: ParsedCommit[],
  config: ChangelogConfig,
): ComputeNextVersionResult {
  if (!isValidSemver(currentVersion)) {
    throw new Error(`Current version is not valid semver: ${currentVersion}`)
  }
  if (commits.length === 0) {
    return { next: currentVersion, level: 'none' }
  }

  if (config.bumpMode === 'custom') {
    if (!config.customBump) {
      throw new Error("bumpMode='custom' requires a customBump function")
    }
    const next = config.customBump(commits, currentVersion)
    if (!isValidSemver(next)) {
      throw new Error(`customBump returned invalid semver: ${next}`)
    }
    if (next === currentVersion) return { next, level: 'none' }
    return { next, level: inferLevel(currentVersion, next) }
  }

  if (config.bumpMode === 'commit-count') {
    // Breaking changes still escalate to a single major bump.
    const hasBreaking = commits.some((c) => c.breaking)
    if (hasBreaking) {
      return { next: inc(currentVersion, 'major'), level: 'major' }
    }
    const n = commits.length
    return { next: incPatchBy(currentVersion, n), level: n > 0 ? 'patch' : 'none' }
  }

  // semver
  const level = deriveSemverBump(commits, config.bumpMap)
  return { next: inc(currentVersion, level), level }
}

function inferLevel(prev: string, next: string): BumpLevel {
  // Best-effort: compare the major/minor/patch deltas to label the level.
  // Used only for reporting when the user supplies a customBump.
  const [pM, pN, pP] = prev.split(/[.+-]/).map(Number)
  const [nM, nN, nP] = next.split(/[.+-]/).map(Number)
  if (nM !== pM) return 'major'
  if (nN !== pN) return 'minor'
  if (nP !== pP) return 'patch'
  return 'none'
}
