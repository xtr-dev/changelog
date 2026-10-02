import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { defaultConfig, loadConfig, mergeConfig } from '../src/config.js'
import type { ChangelogConfig } from '../src/types.js'

const merge = (user: unknown) => mergeConfig(defaultConfig(), user as Partial<ChangelogConfig>)

describe('mergeConfig validation', () => {
  it('accepts the defaults and a $schema key', () => {
    const cfg = merge({ $schema: 'https://example.com/schema.json', bumpMode: 'semver' })
    expect(cfg.bumpMode).toBe('semver')
    expect('$schema' in cfg).toBe(false)
  })

  it('rejects unknown keys', () => {
    expect(() => merge({ bumpmode: 'semver' })).toThrow(/unknown key "bumpmode"/)
    expect(() => merge({ output: { markdwon: false } })).toThrow(/unknown output "markdwon"/)
    expect(() => merge({ output: { markdown: { path: 'x.md', preface: '' } } })).toThrow(
      /unknown key "output.markdown.preface"/,
    )
  })

  it('rejects wrong types and reports every problem at once', () => {
    let message = ''
    try {
      merge({ bumpMode: 'fast', bumpMap: { feat: 'huge' }, initialVersion: '1.0', excludeTypes: 'chore' })
    } catch (err) {
      message = (err as Error).message
    }
    expect(message).toMatch(/bumpMode must be/)
    expect(message).toMatch(/bumpMap.feat must be one of/)
    expect(message).toMatch(/initialVersion must be a semver string/)
    expect(message).toMatch(/excludeTypes must be an array of strings/)
  })

  it('validates output shapes', () => {
    expect(() =>
      merge({ output: { versionsJson: { path: 'v.json', archivePath: 'a.json', archiveAfter: 0 } } }),
    ).toThrow(/archiveAfter must be a positive integer/)
    expect(() => merge({ output: { packageJson: true } })).toThrow(/output.packageJson must be an object or false/)
  })

  it('still requires at least one output', () => {
    expect(() => merge({ output: { versionsJson: false } })).toThrow(/At least one output/)
  })

  it('requires customBump in custom mode', () => {
    expect(() => merge({ bumpMode: 'custom' })).toThrow(/customBump/)
  })
})

describe('loadConfig', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'xtr-changelog-config-'))
    execFileSync('git', ['init', '-q'], { cwd: dir })
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('reads changelog.config.json', async () => {
    writeFileSync(join(dir, 'changelog.config.json'), JSON.stringify({ tagPrefix: 'release-' }))
    expect((await loadConfig(dir)).tagPrefix).toBe('release-')
  })

  it('reads package.json#changelog', async () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ changelog: { bumpMode: 'commit-count' } }))
    expect((await loadConfig(dir)).bumpMode).toBe('commit-count')
  })

  it('loads an .mjs config with functions', async () => {
    writeFileSync(
      join(dir, 'changelog.config.mjs'),
      "export default { bumpMode: 'custom', customBump: (_c, v) => v }\n",
    )
    const cfg = await loadConfig(dir)
    expect(typeof cfg.customBump).toBe('function')
  })

  it('refuses TypeScript configs with a clear message', async () => {
    writeFileSync(join(dir, 'changelog.config.ts'), 'export default {}\n')
    await expect(loadConfig(dir)).rejects.toThrow(/TypeScript configs are not loaded/)
  })

  it('detects the repository URL from package.json, then the origin remote', async () => {
    expect((await loadConfig(dir)).repositoryUrl).toBeUndefined()

    execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:o/from-remote.git'], { cwd: dir })
    expect((await loadConfig(dir)).repositoryUrl).toBe('https://github.com/o/from-remote')

    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ repository: { type: 'git', url: 'git+https://github.com/o/from-pkg.git' } }),
    )
    expect((await loadConfig(dir)).repositoryUrl).toBe('https://github.com/o/from-pkg')
  })

  it('leaves links off when repositoryUrl is false', async () => {
    execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:o/r.git'], { cwd: dir })
    writeFileSync(join(dir, 'changelog.config.json'), JSON.stringify({ repositoryUrl: false }))
    expect((await loadConfig(dir)).repositoryUrl).toBe(false)
  })
})
