import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { computeNextVersion } from './bump.js'
import { resolveOutputPath } from './config.js'
import { buildChangelogMarkdown, buildVersionEntry, insertChangelogSection } from './format.js'
import { getCommitsSince, getLastTag, isAncestorOfHead } from './git.js'
import { filterCommits, parseCommit } from './parse.js'
import { compareSemver, isValidSemver } from './semver.js'
import type {
  ChangelogConfig,
  ParsedCommit,
  ReleaseInput,
  ReleaseResult,
  VersionEntry,
} from './types.js'
import {
  emptyArchiveFile,
  readArchiveFile,
  readVersionsFile,
  rotate,
  writeJson,
} from './versions-store.js'

interface ResolvedState {
  previousVersion: string
  lastTag: string | null
  rawCommits: ParsedCommit[]
  filteredCommits: ParsedCommit[]
  warnings: string[]
}

async function resolveState(input: ReleaseInput): Promise<ResolvedState> {
  const { cwd, config } = input
  const lastTag = await getLastTag({ cwd, tagPrefix: config.tagPrefix })
  const warnings: string[] = []

  let previousVersion: string
  // Where the commit scan starts. A tag when there is one; otherwise the last
  // commit versions.json says it shipped, so an untagged repo does not
  // re-release its whole history on every run.
  let rangeStart: string | null = lastTag
  const head = lastTag ? null : await readVersionsJsonHead(cwd, config)
  if (input.currentVersionOverride) {
    previousVersion = input.currentVersionOverride
  } else if (lastTag) {
    previousVersion = lastTag.slice(config.tagPrefix.length)
  } else {
    // No tag to anchor to (a shallow clone, or a repo that does not tag).
    // Take the highest version any enabled output has already recorded, so
    // successive releases still move forward. Using the max rather than a
    // fixed precedence keeps this monotonic whichever outputs are enabled.
    const candidates = [
      await readPackageVersion(cwd, config),
      head?.version ?? null,
    ].filter((v): v is string => v !== null)

    previousVersion = candidates.length > 0
      ? candidates.reduce((a, b) => (compareSemver(a, b) >= 0 ? a : b))
      : config.initialVersion

    if (!config.output.packageJson && !config.output.versionsJson) {
      warnings.push(
        'No tag matching tagPrefix was found, and neither output.packageJson nor ' +
          'output.versionsJson is enabled, so this release is not recorded anywhere ' +
          'the next run can read. Every run will re-stamp the same version. Enable ' +
          'one of those outputs, tag releases (--tag), or pass currentVersionOverride.',
      )
    }
  }
  if (!isValidSemver(previousVersion)) {
    throw new Error(`Previous version is not valid semver: ${previousVersion}`)
  }

  if (head?.commit) {
    if (await isAncestorOfHead(head.commit, { cwd })) {
      rangeStart = head.commit
    } else {
      warnings.push(
        `versions.json records ${head.version} at commit ${head.commit}, which is not ` +
          'in the history of HEAD (rewritten history?). Scanning all commits instead.',
      )
    }
  }

  const raw = await getCommitsSince(rangeStart, { cwd, paths: config.paths })
  const parsed = raw.map(parseCommit)
  const releaseCommit = releaseCommitPattern(config.releaseCommitMessage)
  const filtered = filterCommits(
    parsed.filter((c) => !releaseCommit.test(c.raw.subject)),
    {
      includeTypes: config.includeTypes,
      excludeTypes: config.excludeTypes,
    },
  )
  return { previousVersion, lastTag, rawCommits: parsed, filteredCommits: filtered, warnings }
}

/**
 * Release commits are bookkeeping, not changes: never let one count toward
 * the next release. Matches the configured template with any version in it.
 */
export function releaseCommitPattern(template: string): RegExp {
  const escaped = template
    .split('{version}')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('\\S+')
  return new RegExp(`^${escaped}$`)
}

/**
 * Newest entry recorded in versions.json, if that output is enabled and the
 * file holds a usable entry. This is the anchor of last resort when the repo
 * has no tags -- versions.json is written on every release, so it is the one
 * artifact guaranteed to reflect what was last shipped.
 */
async function readVersionsJsonHead(
  cwd: string,
  config: ChangelogConfig,
): Promise<VersionEntry | null> {
  if (!config.output.versionsJson) return null
  const versionsPath = resolveOutputPath(cwd, config.output.versionsJson.path)
  try {
    const file = await readVersionsFile(versionsPath)
    const head = file.versions[0]
    return head && isValidSemver(head.version) ? head : null
  } catch {
    return null
  }
}

async function readPackageVersion(
  cwd: string,
  config: ChangelogConfig,
): Promise<string | null> {
  const pkgPath = join(
    cwd,
    typeof config.output.packageJson === 'object' ? config.output.packageJson.path : 'package.json',
  )
  if (!existsSync(pkgPath)) return null
  try {
    const raw = await readFile(pkgPath, 'utf8')
    const pkg = JSON.parse(raw) as { version?: string }
    return pkg.version && isValidSemver(pkg.version) ? pkg.version : null
  } catch {
    return null
  }
}

export interface PreviewResult extends ReleaseResult {}

/**
 * Compute what would be released, without writing anything.
 */
export async function preview(input: ReleaseInput): Promise<PreviewResult> {
  const { config } = input
  const state = await resolveState(input)
  const { next, level } = computeNextVersion(
    state.previousVersion,
    state.filteredCommits,
    config,
    {
      ...(input.preid !== undefined ? { preid: input.preid } : {}),
      ...(input.releaseAs !== undefined ? { releaseAs: input.releaseAs } : {}),
    },
  )

  if (level === 'none' || next === state.previousVersion) {
    return {
      released: false,
      previousVersion: state.previousVersion,
      version: state.previousVersion,
      bumpLevel: 'none',
      entry: null,
      filesWritten: [],
      commits: state.filteredCommits,
      warnings: state.warnings,
    }
  }

  const date = (input.now ?? new Date()).toISOString().slice(0, 10)
  const entry = buildVersionEntry({
    version: next,
    date,
    commits: state.filteredCommits,
    config,
  })
  return {
    released: true,
    previousVersion: state.previousVersion,
    version: next,
    bumpLevel: level,
    entry,
    filesWritten: [],
    commits: state.filteredCommits,
    warnings: state.warnings,
  }
}

export interface ExecuteOptions {
  /** Files to update on disk. Default: every output enabled in config. */
}

/**
 * Same as preview, but writes the configured output files. Idempotent: if no
 * release is warranted, no files are written.
 */
export async function release(input: ReleaseInput): Promise<ReleaseResult> {
  const result = await preview(input)
  if (!result.released || !result.entry) return result

  const { cwd, config } = input
  const filesWritten: string[] = []

  // Rotate exactly once. Both versions.json and CHANGELOG.md are rendered from
  // this single result -- re-reading versions.json after writing it and
  // rotating again would insert the new entry a second time.
  let activeVersions: VersionEntry[] = [result.entry]
  let archivedVersions: VersionEntry[] = emptyArchiveFile().versions

  if (config.output.versionsJson) {
    const versionsPath = resolveOutputPath(cwd, config.output.versionsJson.path)
    const archivePath = resolveOutputPath(cwd, config.output.versionsJson.archivePath)
    const versions = await readVersionsFile(versionsPath)
    const archive = await readArchiveFile(archivePath)
    const rotated = rotate(
      versions,
      archive,
      result.entry,
      config.output.versionsJson.archiveAfter,
    )
    await writeJson(versionsPath, rotated.versions)
    filesWritten.push(versionsPath)
    if (rotated.archiveChanged) {
      await writeJson(archivePath, rotated.archive)
      filesWritten.push(archivePath)
    }
    activeVersions = rotated.versions.versions
    archivedVersions = rotated.archive.versions
  }

  if (config.output.markdown) {
    const mdPath = resolveOutputPath(cwd, config.output.markdown.path)
    // With versions.json on, CHANGELOG.md is a pure rendering of it and is
    // rebuilt in full. Without it, the markdown file is the only history there
    // is, so the new section is inserted and everything else is kept.
    const md = config.output.versionsJson
      ? buildFullChangelogMarkdown(config, activeVersions, archivedVersions)
      : insertChangelogSection(
          existsSync(mdPath) ? await readFile(mdPath, 'utf8') : null,
          result.entry,
          config,
        )
    await writeFile(mdPath, md, 'utf8')
    filesWritten.push(mdPath)
  }

  if (config.output.packageJson) {
    const pkgPath = resolveOutputPath(cwd, config.output.packageJson.path)
    if (await updateJsonFile(pkgPath, (pkg) => {
      pkg.version = result.version
    })) {
      filesWritten.push(pkgPath)
    }
    // Keep the lockfile's copy of the root version in step, or the release
    // commit leaves package-lock.json claiming the old version.
    const lockPath = join(dirname(pkgPath), 'package-lock.json')
    if (await updateJsonFile(lockPath, (lock) => {
      lock.version = result.version
      const packages = lock.packages as Record<string, Record<string, unknown>> | undefined
      if (packages?.['']) packages[''].version = result.version
    })) {
      filesWritten.push(lockPath)
    }
  }

  return { ...result, filesWritten }
}

/**
 * Rewrite a JSON file in place, preserving its indentation and trailing
 * newline. Returns false when the file does not exist.
 */
async function updateJsonFile(
  path: string,
  mutate: (data: Record<string, unknown>) => void,
): Promise<boolean> {
  if (!existsSync(path)) return false
  const raw = await readFile(path, 'utf8')
  const trailingNewline = raw.endsWith('\n') ? '\n' : ''
  const indent = /^[ \t]+(?=")/m.exec(raw)?.[0] ?? '  '
  const data = JSON.parse(raw) as Record<string, unknown>
  mutate(data)
  await writeFile(path, JSON.stringify(data, null, indent) + trailingNewline, 'utf8')
  return true
}

function buildFullChangelogMarkdown(
  config: ChangelogConfig,
  activeVersions: VersionEntry[],
  archivedVersions: VersionEntry[],
): string {
  const all = [...activeVersions, ...archivedVersions]
  const preamble =
    typeof config.output.markdown === 'object' ? config.output.markdown.preamble : ''
  return buildChangelogMarkdown(all, config, preamble)
}
