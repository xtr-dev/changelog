import { compareSemver, inc, incPatchBy, isValidSemver, levelRank, parseSemver } from './semver.js'
import type { BumpLevel, ChangelogConfig, ParsedCommit } from './types.js'

/** Highest of two bump levels. */
export function maxBump(a: BumpLevel, b: BumpLevel): BumpLevel {
  return levelRank(a) >= levelRank(b) ? a : b
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

export interface ComputeNextVersionOptions {
  /** Cut a pre-release with this identifier (e.g. 'beta' → 1.3.0-beta.0). */
  preid?: string
  /** Force this exact version instead of deriving one from the commits. */
  releaseAs?: string
}

/**
 * Compute the next version given the current version, the commits since it,
 * and the config. Returns level='none' (and next === current) if no release.
 */
export function computeNextVersion(
  currentVersion: string,
  commits: ParsedCommit[],
  config: ChangelogConfig,
  options: ComputeNextVersionOptions = {},
): ComputeNextVersionResult {
  if (!isValidSemver(currentVersion)) {
    throw new Error(`Current version is not valid semver: ${currentVersion}`)
  }

  if (options.releaseAs !== undefined) {
    const next = options.releaseAs.replace(/^v/, '')
    if (!isValidSemver(next)) {
      throw new Error(`releaseAs is not valid semver: ${options.releaseAs}`)
    }
    if (compareSemver(next, currentVersion) <= 0) {
      throw new Error(`releaseAs ${next} must be greater than the current version ${currentVersion}`)
    }
    return { next, level: inferLevel(currentVersion, next) }
  }

  if (commits.length === 0) {
    return { next: currentVersion, level: 'none' }
  }

  const preid = options.preid ?? config.prerelease
  // Before 1.0.0, semver lets anything change, so many projects treat a
  // breaking change as a minor bump until they declare a stable API.
  const capPreMajor = (level: BumpLevel): BumpLevel =>
    level === 'major' && config.bumpMinorPreMajor && parseSemver(currentVersion).major === 0
      ? 'minor'
      : level

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
      const level = capPreMajor('major')
      return { next: inc(currentVersion, level, preid), level }
    }
    const n = commits.length
    return { next: incPatchBy(currentVersion, n, preid), level: 'patch' }
  }

  // semver
  const level = capPreMajor(deriveSemverBump(commits, config.bumpMap))
  if (level === 'none') return { next: currentVersion, level }
  return { next: inc(currentVersion, level, preid), level }
}

function inferLevel(prev: string, next: string): BumpLevel {
  // Best-effort: compare the major/minor/patch deltas to label the level.
  // Used only for reporting when the version is not derived from commits.
  const p = parseSemver(prev)
  const n = parseSemver(next)
  if (n.major !== p.major) return 'major'
  if (n.minor !== p.minor) return 'minor'
  if (n.patch !== p.patch) return 'patch'
  // Same X.Y.Z, different pre-release: still a release, report it as a patch.
  return compareSemver(next, prev) !== 0 ? 'patch' : 'none'
}
