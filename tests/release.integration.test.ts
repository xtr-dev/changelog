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

  it('writes each version section exactly once in CHANGELOG.md', async () => {
    repo.commit('feat(cli): support --json')
    const config: ChangelogConfig = {
      ...defaultConfig(),
      output: {
        ...defaultConfig().output,
        markdown: { path: 'CHANGELOG.md', preamble: '' },
      },
    }
    await release({ cwd: repo.cwd, config })
    const md = readFileSync(join(repo.cwd, 'CHANGELOG.md'), 'utf8')
    const headings = md.match(/^## \[/gm) ?? []
    expect(headings).toHaveLength(1)
  })

  it('does not duplicate sections across successive releases', async () => {
    const config: ChangelogConfig = {
      ...defaultConfig(),
      output: {
        ...defaultConfig().output,
        markdown: { path: 'CHANGELOG.md', preamble: '' },
      },
    }

    repo.commit('feat: first')
    const first = await release({ cwd: repo.cwd, config })
    repo.tag(`v${first.version}`)
    repo.commit('feat: second')
    await release({ cwd: repo.cwd, config })

    const md = readFileSync(join(repo.cwd, 'CHANGELOG.md'), 'utf8')
    const headings = md.match(/^## \[[^\]]+\]/gm) ?? []
    expect(headings).toHaveLength(2)
    expect(new Set(headings).size).toBe(2)
  })

  it('renders markdown when versionsJson output is disabled', async () => {
    repo.commit('feat: only markdown')
    const config: ChangelogConfig = {
      ...defaultConfig(),
      output: {
        versionsJson: false,
        markdown: { path: 'CHANGELOG.md', preamble: '' },
        packageJson: false,
      },
    }
    await release({ cwd: repo.cwd, config })
    const md = readFileSync(join(repo.cwd, 'CHANGELOG.md'), 'utf8')
    expect(md.match(/^## \[/gm) ?? []).toHaveLength(1)
    expect(md).toContain('only markdown')
    expect(existsSync(join(repo.cwd, 'changelog/versions.json'))).toBe(false)
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

  it('advances the version across untagged releases via versions.json (#8)', async () => {
    // No v* tags and packageJson output off: versions.json is the only record
    // of what shipped, so it has to be the anchor or every run re-stamps the
    // same version.
    const config: ChangelogConfig = {
      ...defaultConfig(),
      output: {
        versionsJson: {
          path: 'changelog/versions.json',
          archivePath: 'changelog/archive.json',
          archiveAfter: 10,
        },
        markdown: false,
        packageJson: false,
      },
    }

    const seen: string[] = []
    for (const subject of ['feat: a', 'feat: b', 'feat: c']) {
      repo.commit(subject)
      const result = await release({ cwd: repo.cwd, config })
      seen.push(result.version)
    }

    expect(seen).toEqual(['0.1.0', '0.2.0', '0.3.0'])
    expect(new Set(seen).size).toBe(3)

    const store = JSON.parse(
      readFileSync(join(repo.cwd, 'changelog/versions.json'), 'utf8'),
    ) as { versions: { version: string }[] }
    expect(store.versions.map((v) => v.version)).toEqual(['0.3.0', '0.2.0', '0.1.0'])
  })

  it('prefers the highest anchor when package.json lags versions.json (#8)', async () => {
    // package.json is stale at 0.0.0 because packageJson output is off; the
    // higher versions.json entry must win so the release still moves forward.
    writeFileSync(
      join(repo.cwd, 'package.json'),
      JSON.stringify({ name: 'x', version: '0.0.0' }, null, 2),
    )
    const config: ChangelogConfig = {
      ...defaultConfig(),
      output: {
        versionsJson: {
          path: 'changelog/versions.json',
          archivePath: 'changelog/archive.json',
          archiveAfter: 10,
        },
        markdown: false,
        packageJson: false,
      },
    }

    repo.commit('feat: a')
    const first = await release({ cwd: repo.cwd, config })
    expect(first.version).toBe('0.1.0')

    repo.commit('feat: b')
    const second = await release({ cwd: repo.cwd, config })
    expect(second.previousVersion).toBe('0.1.0')
    expect(second.version).toBe('0.2.0')
  })

  it('still prefers a tag over versions.json when one exists', async () => {
    const config: ChangelogConfig = { ...defaultConfig(), output: { ...defaultConfig().output } }
    repo.commit('feat: a')
    await release({ cwd: repo.cwd, config })
    repo.tag('v2.0.0')
    repo.commit('fix: b')

    const result = await release({ cwd: repo.cwd, config })
    expect(result.previousVersion).toBe('2.0.0')
    expect(result.version).toBe('2.0.1')
  })

  it('warns when nothing durable records the version (#8)', async () => {
    // markdown-only is the reachable form of this: loadConfig rejects a config
    // with every output disabled, but markdown alone still records nothing a
    // later run can read back.
    const config: ChangelogConfig = {
      ...defaultConfig(),
      output: {
        versionsJson: false,
        markdown: { path: 'CHANGELOG.md', preamble: '' },
        packageJson: false,
      },
    }
    repo.commit('feat: a')
    const first = await release({ cwd: repo.cwd, config })

    expect(first.warnings).toHaveLength(1)
    expect(first.warnings[0]).toMatch(/re-stamp the same version/)

    // and the warning is telling the truth: the next run does re-stamp.
    repo.commit('feat: b')
    const second = await release({ cwd: repo.cwd, config })
    expect(second.version).toBe(first.version)
  })

  it('does not warn when an output records the version', async () => {
    const config: ChangelogConfig = { ...defaultConfig(), output: { ...defaultConfig().output } }
    repo.commit('feat: a')
    const result = await release({ cwd: repo.cwd, config })
    expect(result.warnings).toEqual([])
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
