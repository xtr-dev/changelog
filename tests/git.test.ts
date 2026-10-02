import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { getCommitsSince, getLastTag, isAncestorOfHead } from '../src/git.js'
import { createTempRepo, type TempRepo } from './helpers/temp-repo.js'

describe('git helpers', () => {
  let repo: TempRepo
  beforeEach(() => {
    repo = createTempRepo()
  })
  afterEach(() => {
    repo.cleanup()
  })

  it('ignores tags that are not reachable from HEAD', async () => {
    repo.commit('feat: base')
    repo.tag('v1.0.0')
    repo.git(['checkout', '-b', 'next'])
    repo.commit('feat!: big')
    repo.tag('v2.0.0')
    repo.git(['checkout', 'main'])
    repo.commit('fix: hotfix')

    expect(await getLastTag({ cwd: repo.cwd, tagPrefix: 'v' })).toBe('v1.0.0')
  })

  it('picks the highest semver tag, not the newest by name', async () => {
    repo.commit('feat: a')
    repo.tag('v0.0.9')
    repo.commit('feat: b')
    repo.tag('v0.0.10')
    expect(await getLastTag({ cwd: repo.cwd, tagPrefix: 'v' })).toBe('v0.0.10')
  })

  it('keeps commit text intact when it contains delimiter-looking words', async () => {
    repo.commit('fix: handle COMMIT and FIELD keywords', 'Body with COMMIT and FIELD.')
    const commits = await getCommitsSince(null, { cwd: repo.cwd })
    expect(commits[0]?.subject).toBe('fix: handle COMMIT and FIELD keywords')
    expect(commits[0]?.body).toBe('Body with COMMIT and FIELD.')
  })

  it('limits commits to the given paths', async () => {
    repo.commit('feat: in pkg', undefined, { path: 'pkg-a.txt', content: 'a' })
    repo.commit('feat: elsewhere', undefined, { path: 'pkg-b.txt', content: 'b' })
    const commits = await getCommitsSince(null, { cwd: repo.cwd, paths: ['pkg-a.txt'] })
    expect(commits.map((c) => c.subject)).toEqual(['feat: in pkg'])
  })

  it('throws on a bad ref instead of reporting no commits', async () => {
    await expect(getCommitsSince('does-not-exist', { cwd: repo.cwd })).rejects.toThrow()
  })

  it('reports ancestry of HEAD', async () => {
    const first = repo.commit('feat: a')
    repo.git(['checkout', '-b', 'side'])
    const side = repo.commit('feat: side')
    repo.git(['checkout', 'main'])
    expect(await isAncestorOfHead(first, { cwd: repo.cwd })).toBe(true)
    expect(await isAncestorOfHead(side, { cwd: repo.cwd })).toBe(false)
  })
})

describe('git helpers on an empty repository', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'xtr-changelog-empty-'))
    execFileSync('git', ['init', '-q'], { cwd: dir })
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('returns no tag and no commits', async () => {
    expect(await getLastTag({ cwd: dir, tagPrefix: 'v' })).toBeNull()
    expect(await getCommitsSince(null, { cwd: dir })).toEqual([])
  })
})
