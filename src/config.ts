import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { join, resolve } from 'node:path'

import { getRemoteUrl } from './git.js'
import { normalizeRepositoryUrl } from './repository.js'
import { isValidSemver } from './semver.js'
import type { BumpLevel, ChangelogConfig, GroupDef } from './types.js'

export const DEFAULT_BUMP_MAP: Record<string, BumpLevel> = {
  feat: 'minor',
  fix: 'patch',
  perf: 'patch',
  refactor: 'patch',
  revert: 'patch',
  docs: 'patch',
  style: 'patch',
  test: 'patch',
  build: 'patch',
  ci: 'patch',
  chore: 'patch',
  a11y: 'patch',
  i18n: 'patch',
  security: 'patch',
}

export const DEFAULT_RELEASE_COMMIT_MESSAGE = 'chore(release): v{version} [skip ci]'

export const DEFAULT_GROUPS: GroupDef[] = [
  { title: 'Features', key: 'features', types: ['feat'] },
  { title: 'Fixes', key: 'fixes', types: ['fix', 'perf'] },
  {
    title: 'Other',
    key: 'other',
    types: [
      'refactor',
      'docs',
      'style',
      'test',
      'build',
      'ci',
      'chore',
      'revert',
      'a11y',
      'i18n',
      'security',
    ],
  },
]

export function defaultConfig(): ChangelogConfig {
  return {
    bumpMode: 'semver',
    initialVersion: '0.0.0',
    bumpMap: { ...DEFAULT_BUMP_MAP },
    includeTypes: null,
    excludeTypes: [],
    groups: DEFAULT_GROUPS.map((g) => ({ ...g, types: [...g.types] })),
    output: {
      versionsJson: {
        path: 'changelog/versions.json',
        archivePath: 'changelog/archive.json',
        archiveAfter: 10,
      },
      markdown: false,
      packageJson: false,
    },
    tagPrefix: 'v',
    releaseCommitMessage: DEFAULT_RELEASE_COMMIT_MESSAGE,
  }
}

const CONFIG_FILES = [
  'changelog.config.ts',
  'changelog.config.mts',
  'changelog.config.js',
  'changelog.config.mjs',
  'changelog.config.cjs',
  'changelog.config.json',
]

export async function loadConfig(cwd: string): Promise<ChangelogConfig> {
  const userConfig = await loadUserConfig(cwd)
  const config = mergeConfig(defaultConfig(), userConfig)
  if (config.repositoryUrl === undefined) {
    const detected = await detectRepositoryUrl(cwd)
    if (detected) config.repositoryUrl = detected
  } else if (typeof config.repositoryUrl === 'string') {
    config.repositoryUrl = normalizeRepositoryUrl(config.repositoryUrl) ?? config.repositoryUrl
  }
  return config
}

async function detectRepositoryUrl(cwd: string): Promise<string | null> {
  const pkgPath = join(cwd, 'package.json')
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(await readFile(pkgPath, 'utf8')) as { repository?: unknown }
      const fromPkg = normalizeRepositoryUrl(pkg.repository)
      if (fromPkg) return fromPkg
    } catch {
      // A broken package.json is reported where it matters (packageJson output).
    }
  }
  return normalizeRepositoryUrl(await getRemoteUrl('origin', { cwd }))
}

async function loadUserConfig(cwd: string): Promise<Partial<ChangelogConfig>> {
  // 1. Dedicated file
  for (const name of CONFIG_FILES) {
    const path = join(cwd, name)
    if (!existsSync(path)) continue
    if (name.endsWith('.json')) {
      const raw = await readFile(path, 'utf8')
      return JSON.parse(raw) as Partial<ChangelogConfig>
    }
    if (name.endsWith('.ts') || name.endsWith('.mts')) {
      throw new Error(
        `Found ${name} but TypeScript configs are not loaded directly. Compile to .js or use changelog.config.json / package.json#changelog.`,
      )
    }
    const url = pathToFileURL(path).href
    const mod = (await import(url)) as {
      default?: Partial<ChangelogConfig>
    } & Partial<ChangelogConfig>
    return mod.default ?? mod
  }
  // 2. package.json#changelog
  const pkgPath = join(cwd, 'package.json')
  if (existsSync(pkgPath)) {
    const raw = await readFile(pkgPath, 'utf8')
    const pkg = JSON.parse(raw) as { changelog?: Partial<ChangelogConfig> }
    if (pkg.changelog) return pkg.changelog
  }
  return {}
}

export function mergeConfig(
  base: ChangelogConfig,
  user: Partial<ChangelogConfig>,
): ChangelogConfig {
  validateUserConfig(user)
  const { $schema: _schema, ...rest } = user as Partial<ChangelogConfig> & { $schema?: string }
  const merged: ChangelogConfig = {
    ...base,
    ...rest,
    bumpMap: { ...base.bumpMap, ...(user.bumpMap ?? {}) },
    groups: user.groups ?? base.groups,
    output: {
      versionsJson:
        user.output?.versionsJson === undefined
          ? base.output.versionsJson
          : user.output.versionsJson,
      markdown: user.output?.markdown === undefined ? base.output.markdown : user.output.markdown,
      packageJson:
        user.output?.packageJson === undefined ? base.output.packageJson : user.output.packageJson,
    },
  }
  validateConfig(merged)
  return merged
}

const LEVELS = ['major', 'minor', 'patch', 'none']
const KNOWN_KEYS = new Set([
  '$schema',
  'bumpMode',
  'customBump',
  'initialVersion',
  'prerelease',
  'bumpMinorPreMajor',
  'bumpMap',
  'includeTypes',
  'excludeTypes',
  'groups',
  'output',
  'repositoryUrl',
  'tagPrefix',
  'releaseCommitMessage',
  'paths',
  'formatter',
])
const OUTPUT_KEYS: Record<string, string[]> = {
  versionsJson: ['path', 'archivePath', 'archiveAfter'],
  markdown: ['path', 'preamble'],
  packageJson: ['path'],
}

/**
 * Check a user config before it is merged, so typos and wrong types fail
 * loudly instead of being silently ignored. Collects every problem.
 */
function validateUserConfig(user: unknown): void {
  if (user === null || typeof user !== 'object' || Array.isArray(user)) {
    throw new Error('Invalid config: expected an object')
  }
  const u = user as Record<string, unknown>
  const errors: string[] = []
  const isStringArray = (v: unknown) => Array.isArray(v) && v.every((x) => typeof x === 'string')

  for (const key of Object.keys(u)) {
    if (!KNOWN_KEYS.has(key)) errors.push(`unknown key "${key}"`)
  }
  if ('bumpMode' in u && !['semver', 'commit-count', 'custom'].includes(u.bumpMode as string)) {
    errors.push(
      `bumpMode must be 'semver', 'commit-count' or 'custom' (got ${JSON.stringify(u.bumpMode)})`,
    )
  }
  if ('customBump' in u && typeof u.customBump !== 'function')
    errors.push('customBump must be a function')
  if ('formatter' in u && typeof u.formatter !== 'function')
    errors.push('formatter must be a function')
  if (
    'initialVersion' in u &&
    (typeof u.initialVersion !== 'string' || !isValidSemver(u.initialVersion))
  ) {
    errors.push(`initialVersion must be a semver string (got ${JSON.stringify(u.initialVersion)})`)
  }
  if (
    'prerelease' in u &&
    (typeof u.prerelease !== 'string' || !/^[0-9A-Za-z-]+$/.test(u.prerelease))
  ) {
    errors.push('prerelease must be an identifier like "beta" or "rc"')
  }
  if ('bumpMinorPreMajor' in u && typeof u.bumpMinorPreMajor !== 'boolean') {
    errors.push('bumpMinorPreMajor must be a boolean')
  }
  for (const key of ['tagPrefix', 'releaseCommitMessage']) {
    if (key in u && typeof u[key] !== 'string') errors.push(`${key} must be a string`)
  }
  if ('repositoryUrl' in u && u.repositoryUrl !== false && typeof u.repositoryUrl !== 'string') {
    errors.push('repositoryUrl must be a string or false')
  }
  if ('paths' in u && !isStringArray(u.paths)) errors.push('paths must be an array of strings')
  if ('includeTypes' in u && u.includeTypes !== null && !isStringArray(u.includeTypes)) {
    errors.push('includeTypes must be an array of strings or null')
  }
  if ('excludeTypes' in u && !isStringArray(u.excludeTypes))
    errors.push('excludeTypes must be an array of strings')
  if ('bumpMap' in u) {
    const map = u.bumpMap
    if (!map || typeof map !== 'object' || Array.isArray(map)) {
      errors.push('bumpMap must be an object of type → level')
    } else {
      for (const [type, level] of Object.entries(map)) {
        if (!LEVELS.includes(level as string)) {
          errors.push(
            `bumpMap.${type} must be one of ${LEVELS.join(', ')} (got ${JSON.stringify(level)})`,
          )
        }
      }
    }
  }
  if ('groups' in u) {
    if (!Array.isArray(u.groups)) {
      errors.push('groups must be an array')
    } else {
      u.groups.forEach((g: unknown, i: number) => {
        const group = g as Partial<GroupDef> | null
        if (
          !group ||
          typeof group.title !== 'string' ||
          typeof group.key !== 'string' ||
          !isStringArray(group.types)
        ) {
          errors.push(`groups[${i}] must be { title: string, key: string, types: string[] }`)
        }
      })
    }
  }
  if ('output' in u) {
    const output = u.output as Record<string, unknown> | null
    if (!output || typeof output !== 'object' || Array.isArray(output)) {
      errors.push('output must be an object')
    } else {
      for (const [name, value] of Object.entries(output)) {
        const fields = OUTPUT_KEYS[name]
        if (!fields) {
          errors.push(`unknown output "${name}"`)
          continue
        }
        if (value === false) continue
        if (!value || typeof value !== 'object') {
          errors.push(`output.${name} must be an object or false`)
          continue
        }
        const v = value as Record<string, unknown>
        for (const k of Object.keys(v)) {
          if (!fields.includes(k)) errors.push(`unknown key "output.${name}.${k}"`)
        }
        if (typeof v.path !== 'string') errors.push(`output.${name}.path must be a string`)
        if (name === 'versionsJson') {
          if (typeof v.archivePath !== 'string')
            errors.push('output.versionsJson.archivePath must be a string')
          if (!Number.isInteger(v.archiveAfter) || (v.archiveAfter as number) < 1) {
            errors.push('output.versionsJson.archiveAfter must be a positive integer')
          }
        }
        if (name === 'markdown' && 'preamble' in v && typeof v.preamble !== 'string') {
          errors.push('output.markdown.preamble must be a string')
        }
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(`Invalid config:\n  - ${errors.join('\n  - ')}`)
  }
}

function validateConfig(c: ChangelogConfig): void {
  if (c.bumpMode === 'custom' && typeof c.customBump !== 'function') {
    throw new Error("bumpMode='custom' requires a customBump function")
  }
  const anyOutput = c.output.versionsJson || c.output.markdown || c.output.packageJson
  if (!anyOutput) {
    throw new Error(
      'At least one output target must be enabled (versionsJson | markdown | packageJson).',
    )
  }
}

/**
 * Resolve a path against `cwd`. Convenience for callers that want absolute paths.
 */
export function resolveOutputPath(cwd: string, path: string): string {
  return resolve(cwd, path)
}
