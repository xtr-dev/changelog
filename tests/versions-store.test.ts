import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  emptyArchiveFile,
  emptyVersionsFile,
  readArchiveFile,
  readVersionsFile,
  rotate,
  writeJson,
} from '../src/versions-store.js'
import type { VersionEntry } from '../src/types.js'

const entry = (v: string): VersionEntry => ({
  version: v,
  date: '2026-05-09',
  commit: 'abc',
  breaking: false,
  groups: { features: [{ type: 'feat', scope: null, description: 'x', commit: 'abc', breaking: false, notes: [] }] },
})

describe('rotate', () => {
  it('inserts new entry at head', () => {
    const result = rotate(emptyVersionsFile(), emptyArchiveFile(), entry('0.1.0'), 10)
    expect(result.versions.versions[0]?.version).toBe('0.1.0')
    expect(result.archiveChanged).toBe(false)
  })

  it('rotates oldest into archive past archiveAfter', () => {
    let v = emptyVersionsFile()
    const a = emptyArchiveFile()
    for (let i = 1; i <= 10; i++) {
      v = rotate(v, a, entry(`0.0.${i}`), 10).versions
    }
    // 11th push triggers rotation.
    const result = rotate(v, a, entry('0.0.11'), 10)
    expect(result.versions.versions).toHaveLength(10)
    expect(result.versions.versions[0]?.version).toBe('0.0.11')
    expect(result.archiveChanged).toBe(true)
    expect(result.archive.versions[0]?.version).toBe('0.0.1')
  })
})

describe('versions-store I/O', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'xtr-store-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('returns empty file when not present', async () => {
    const v = await readVersionsFile(join(dir, 'missing.json'))
    expect(v.versions).toEqual([])
  })

  it('round-trips JSON', async () => {
    const path = join(dir, 'versions.json')
    const file = { ...emptyVersionsFile(), versions: [entry('0.1.0')] }
    await writeJson(path, file)
    const loaded = await readVersionsFile(path)
    expect(loaded.versions).toHaveLength(1)
    const onDisk = readFileSync(path, 'utf8')
    expect(onDisk.endsWith('\n')).toBe(true)
  })

  it('normalizes legacy bare-array format', async () => {
    const path = join(dir, 'legacy.json')
    await writeJson(path, [entry('0.1.0')])
    const loaded = await readVersionsFile(path)
    expect(loaded.versions).toHaveLength(1)
    expect(loaded.schemaVersion).toBe(2)
  })

  it('archive file behaves the same', async () => {
    const v = await readArchiveFile(join(dir, 'missing.json'))
    expect(v.versions).toEqual([])
  })
})
