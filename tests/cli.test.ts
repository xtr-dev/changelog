import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { TEST_DIST } from './helpers/build-cli.js'
import { createTempRepo, type TempRepo } from './helpers/temp-repo.js'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  version: string
}

function cli(cwd: string, ...args: string[]) {
  const r = spawnSync(process.execPath, [join(TEST_DIST, 'cli.js'), ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  })
  return { code: r.status, stdout: r.stdout, stderr: r.stderr }
}

describe('cli', () => {
  let repo: TempRepo
  beforeEach(() => {
    repo = createTempRepo()
  })
  afterEach(() => {
    repo.cleanup()
  })

  it('prints help and its version', () => {
    expect(cli(repo.cwd, 'help').stdout).toContain('Usage')
    expect(cli(repo.cwd, '--help').stdout).toContain('Usage')
    expect(cli(repo.cwd, '--version').stdout.trim()).toBe(pkg.version)
  })

  it('rejects unknown flags and commands instead of ignoring them', () => {
    const typo = cli(repo.cwd, 'release', '--exceute')
    expect(typo.code).toBe(1)
    expect(typo.stderr).toMatch(/exceute/)

    const misplaced = cli(repo.cwd, 'preview', '--push')
    expect(misplaced.code).toBe(1)
    expect(misplaced.stderr).toMatch(/--push does not apply to "preview"/)

    expect(cli(repo.cwd, 'publish').stderr).toMatch(/unknown command: publish/)
    expect(cli(repo.cwd, 'preview', 'extra').stderr).toMatch(/unexpected argument: extra/)
  })

  it('previews without writing, as text and JSON', () => {
    repo.commit('feat(api): add endpoint')
    const text = cli(repo.cwd, 'preview')
    expect(text.code).toBe(0)
    expect(text.stdout).toContain('0.0.0 → 0.1.0')
    expect(text.stdout).toContain('api: add endpoint')

    const json = JSON.parse(cli(repo.cwd, 'preview', '--json').stdout) as { version: string }
    expect(json.version).toBe('0.1.0')
    expect(existsSync(join(repo.cwd, 'changelog/versions.json'))).toBe(false)
  })

  it('release without --execute is a dry run', () => {
    repo.commit('feat: a')
    const r = cli(repo.cwd, 'release')
    expect(r.stdout).toContain('dry run')
    expect(existsSync(join(repo.cwd, 'changelog/versions.json'))).toBe(false)
  })

  it('release --tag commits and tags with the given message', () => {
    repo.commit('feat: a')
    const r = cli(repo.cwd, 'release', '--tag', '--message', 'release: {version}', '--json')
    expect(r.code).toBe(0)
    const result = JSON.parse(r.stdout) as { version: string; git: { committed: boolean; tag: string } }
    expect(result.git).toEqual({ committed: true, tag: 'v0.1.0', pushed: false })
    expect(repo.git(['log', '-1', '--format=%s']).trim()).toBe('release: 0.1.0')
    expect(repo.git(['tag', '--list']).trim()).toBe('v0.1.0')

    // The release commit itself never counts toward the next one.
    expect(JSON.parse(cli(repo.cwd, 'preview', '--json').stdout).released).toBe(false)
  })

  it('refuses to commit from a dirty tree', () => {
    repo.commit('feat: a')
    writeFileSync(join(repo.cwd, 'dirty.txt'), 'x')
    const r = cli(repo.cwd, 'release', '--commit')
    expect(r.code).toBe(1)
    expect(r.stderr).toMatch(/working tree must be clean/)
  })

  it('supports --preid and --release-as', () => {
    repo.commit('feat: a')
    expect(JSON.parse(cli(repo.cwd, 'preview', '--json', '--preid', 'beta').stdout).version).toBe(
      '0.1.0-beta.0',
    )
    expect(
      JSON.parse(cli(repo.cwd, 'preview', '--json', '--release-as', '1.0.0').stdout).version,
    ).toBe('1.0.0')
  })

  it('prints release notes for the newest or a given version', () => {
    repo.commit('feat: first thing')
    cli(repo.cwd, 'release', '--tag')
    repo.commit('fix: second thing')
    cli(repo.cwd, 'release', '--tag')

    const latest = cli(repo.cwd, 'notes')
    expect(latest.code).toBe(0)
    expect(latest.stdout).toContain('second thing')
    expect(latest.stdout).not.toContain('first thing')
    expect(latest.stdout).not.toMatch(/^## /m)

    expect(cli(repo.cwd, 'notes', 'v0.1.0').stdout).toContain('first thing')
    expect(cli(repo.cwd, 'notes', '9.9.9').stderr).toMatch(/no release 9.9.9 recorded/)
  })

  it('init writes a config with a $schema and refuses to overwrite it', () => {
    expect(cli(repo.cwd, 'init').code).toBe(0)
    const cfg = JSON.parse(readFileSync(join(repo.cwd, 'changelog.config.json'), 'utf8')) as {
      $schema: string
    }
    expect(cfg.$schema).toMatch(/config\.schema\.json$/)
    expect(cli(repo.cwd, 'init').stderr).toMatch(/already exists/)
    // And the scaffolded config loads.
    expect(cli(repo.cwd, 'preview').code).toBe(0)
  })

  it('reports invalid config clearly', () => {
    writeFileSync(join(repo.cwd, 'changelog.config.json'), JSON.stringify({ bumpmode: 'semver' }))
    const r = cli(repo.cwd, 'preview')
    expect(r.code).toBe(1)
    expect(r.stderr).toMatch(/unknown key "bumpmode"/)
  })
})
