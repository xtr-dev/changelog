import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { join, resolve } from 'node:path'

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
  return mergeConfig(defaultConfig(), userConfig)
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
    const mod = (await import(url)) as { default?: Partial<ChangelogConfig> } & Partial<ChangelogConfig>
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
  const merged: ChangelogConfig = {
    ...base,
    ...user,
    bumpMap: { ...base.bumpMap, ...(user.bumpMap ?? {}) },
    groups: user.groups ?? base.groups,
    output: {
      versionsJson:
        user.output?.versionsJson === undefined
          ? base.output.versionsJson
          : user.output.versionsJson,
      markdown:
        user.output?.markdown === undefined
          ? base.output.markdown
          : user.output.markdown,
      packageJson:
        user.output?.packageJson === undefined
          ? base.output.packageJson
          : user.output.packageJson,
    },
  }
  validateConfig(merged)
  return merged
}

function validateConfig(c: ChangelogConfig): void {
  if (!['semver', 'commit-count', 'custom'].includes(c.bumpMode)) {
    throw new Error(`Invalid bumpMode: ${c.bumpMode}`)
  }
  if (c.bumpMode === 'custom' && typeof c.customBump !== 'function') {
    throw new Error("bumpMode='custom' requires a customBump function")
  }
  const anyOutput =
    c.output.versionsJson || c.output.markdown || c.output.packageJson
  if (!anyOutput) {
    throw new Error('At least one output target must be enabled (versionsJson | markdown | packageJson).')
  }
}

/**
 * Resolve a path against `cwd`. Convenience for callers that want absolute paths.
 */
export function resolveOutputPath(cwd: string, path: string): string {
  return resolve(cwd, path)
}
