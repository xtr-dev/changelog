import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { defaultConfig } from '../src/config.js'
import { preview, release } from '../src/release.js'
import type { ChangelogConfig } from '../src/types.js'
import { createTempRepo, type TempRepo } from './helpers/temp-repo.js'

describe('release (integration)', () => {
  let repo: TempRepo
  beforeEach(() => {
    repo = createTempRepo()
  })
  afterEach(() => {
    repo.cleanup()
  })

  it('returns no release when no conventional commits', async () => {
    repo.commit('not a conventional message')
    const cfg = defaultConfig()
    const r = await preview({ cwd: repo.cwd, config: cfg })
    expect(r.released).toBe(false)
  })

  it('cuts an initial 0.1.0 from a feat', async () => {
    repo.commit('feat: hello world')
    const cfg = defaultConfig()
    const r = await preview({ cwd: repo.cwd, config: cfg })
    expect(r.released).toBe(true)
    expect(r.version).toBe('0.1.0')
    expect(r.bumpLevel).toBe('minor')
    expect(r.entry?.groups.features).toHaveLength(1)
  })

  it('respects last tag as the floor', async () => {
    repo.commit('feat: first')
    repo.tag('v0.1.0')
    repo.commit('fix: bug')
    const cfg = defaultConfig()
    const r = await preview({ cwd: repo.cwd, config: cfg })
    expect(r.previousVersion).toBe('0.1.0')
    expect(r.version).toBe('0.1.1')
  })

  it('writes versions.json on release', async () => {
    repo.commit('feat: hello')
    const cfg: ChangelogConfig = defaultConfig()
    const r = await release({ cwd: repo.cwd, config: cfg })
    expect(r.released).toBe(true)
    const path = join(repo.cwd, 'changelog/versions.json')
    expect(existsSync(path)).toBe(true)
    const data = JSON.parse(readFileSync(path, 'utf8')) as {
      schemaVersion: number
      versions: Array<{ version: string }>
    }
    expect(data.schemaVersion).toBe(2)
    expect(data.versions[0]?.version).toBe('0.1.0')
  })

  it('writes CHANGELOG.md when markdown output is enabled', async () => {
    repo.commit('feat(cli): support --json')
    repo.commit('fix: leak')
    const cfg: ChangelogConfig = {
      ...defaultConfig(),
      output: {
        ...defaultConfig().output,
        markdown: { path: 'CHANGELOG.md', preamble: 'Notable changes.' },
      },
    }
    const r = await release({ cwd: repo.cwd, config: cfg })
    expect(r.released).toBe(true)
    const md = readFileSync(join(repo.cwd, 'CHANGELOG.md'), 'utf8')
    expect(md).toMatch(/^# Changelog/)
    expect(md).toContain('Notable changes.')
    expect(md).toContain('### Features')
    expect(md).toContain('**cli:** support --json')
  })

  it('updates package.json#version when enabled', async () => {
    writeFileSync(
      join(repo.cwd, 'package.json'),
      JSON.stringify({ name: 'app', version: '0.0.0' }, null, 2) + '\n',
    )
    repo.commit('feat: x')
    const cfg: ChangelogConfig = {
      ...defaultConfig(),
      output: {
        ...defaultConfig().output,
        packageJson: { path: 'package.json' },
      },
    }
    const r = await release({ cwd: repo.cwd, config: cfg })
    expect(r.version).toBe('0.1.0')
    const pkg = JSON.parse(readFileSync(join(repo.cwd, 'package.json'), 'utf8')) as {
      version: string
    }
    expect(pkg.version).toBe('0.1.0')
  })

  it('does not write anything in preview mode', async () => {
    repo.commit('feat: x')
    const cfg = defaultConfig()
    await preview({ cwd: repo.cwd, config: cfg })
    expect(existsSync(join(repo.cwd, 'changelog/versions.json'))).toBe(false)
  })

  it('commit-count mode produces N patch bumps', async () => {
    repo.commit('feat: a')
    repo.commit('fix: b')
    repo.commit('docs: c')
    repo.commit('chore: d')
    const cfg: ChangelogConfig = { ...defaultConfig(), bumpMode: 'commit-count' }
    const r = await preview({ cwd: repo.cwd, config: cfg })
    expect(r.version).toBe('0.0.4')
    expect(r.bumpLevel).toBe('patch')
  })

  it('rotates archive after the configured threshold', async () => {
    const cfg: ChangelogConfig = {
      ...defaultConfig(),
      output: {
        ...defaultConfig().output,
        versionsJson: {
          path: 'changelog/versions.json',
          archivePath: 'changelog/archive.json',
          archiveAfter: 2,
        },
      },
    }
    repo.commit('feat: a')
    let r = await release({ cwd: repo.cwd, config: cfg })
    repo.tag(`v${r.version}`)
    repo.commit('feat: b')
    r = await release({ cwd: repo.cwd, config: cfg })
    repo.tag(`v${r.version}`)
    repo.commit('feat: c')
    r = await release({ cwd: repo.cwd, config: cfg })

    const versions = JSON.parse(
      readFileSync(join(repo.cwd, 'changelog/versions.json'), 'utf8'),
    ) as { versions: Array<{ version: string }> }
    const archive = JSON.parse(
      readFileSync(join(repo.cwd, 'changelog/archive.json'), 'utf8'),
    ) as { versions: Array<{ version: string }> }
    expect(versions.versions.map((v) => v.version)).toEqual(['0.3.0', '0.2.0'])
    expect(archive.versions.map((v) => v.version)).toEqual(['0.1.0'])
  })
})
