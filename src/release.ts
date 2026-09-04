import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { computeNextVersion } from './bump.js'
import { resolveOutputPath } from './config.js'
import { buildChangelogMarkdown, buildVersionEntry } from './format.js'
import { getCommitsSince, getLastTag } from './git.js'
import { filterCommits, parseCommit } from './parse.js'
import { isValidSemver } from './semver.js'
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
}

async function resolveState(input: ReleaseInput): Promise<ResolvedState> {
  const { cwd, config } = input
  const lastTag = await getLastTag({ cwd, tagPrefix: config.tagPrefix })

  let previousVersion: string
  if (input.currentVersionOverride) {
    previousVersion = input.currentVersionOverride
  } else if (lastTag) {
    previousVersion = lastTag.slice(config.tagPrefix.length)
  } else {
    previousVersion = await readPackageVersion(cwd, config) ?? config.initialVersion
  }
  if (!isValidSemver(previousVersion)) {
    throw new Error(`Previous version is not valid semver: ${previousVersion}`)
  }

  const raw = await getCommitsSince(lastTag, { cwd })
  const parsed = raw.map(parseCommit)
  const filtered = filterCommits(parsed, {
    includeTypes: config.includeTypes,
    excludeTypes: config.excludeTypes,
  })
  return { previousVersion, lastTag, rawCommits: parsed, filteredCommits: filtered }
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
    const md = buildFullChangelogMarkdown(config, activeVersions, archivedVersions)
    const mdPath = resolveOutputPath(cwd, config.output.markdown.path)
    await writeFile(mdPath, md, 'utf8')
    filesWritten.push(mdPath)
  }

  if (config.output.packageJson) {
    const pkgPath = resolveOutputPath(cwd, config.output.packageJson.path)
    if (existsSync(pkgPath)) {
      const raw = await readFile(pkgPath, 'utf8')
      const trailingNewline = raw.endsWith('\n') ? '\n' : ''
      const pkg = JSON.parse(raw) as Record<string, unknown>
      pkg.version = result.version
      await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + trailingNewline, 'utf8')
      filesWritten.push(pkgPath)
    }
  }

  return { ...result, filesWritten }
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
