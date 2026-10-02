import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import Ajv from 'ajv'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { defaultConfig } from '../src/config.js'
import { release } from '../src/release.js'
import { createTempRepo, type TempRepo } from './helpers/temp-repo.js'

const root = new URL('..', import.meta.url).pathname
const readJson = (path: string): unknown => JSON.parse(readFileSync(join(root, path), 'utf8'))

const ajv = new Ajv({ allErrors: true })
const validateVersions = ajv.compile(readJson('schema/versions.schema.json') as object)
const validateConfig = ajv.compile(readJson('schema/config.schema.json') as object)

describe('schemas', () => {
  let repo: TempRepo
  beforeEach(() => {
    repo = createTempRepo()
  })
  afterEach(() => {
    repo.cleanup()
  })

  it('accepts the versions.json this tool writes', async () => {
    repo.commit('feat(api): a', 'BREAKING CHANGE: gone\n\nCloses #1')
    repo.commit('fix: b')
    await release({ cwd: repo.cwd, config: defaultConfig() })
    const data = JSON.parse(readFileSync(join(repo.cwd, 'changelog/versions.json'), 'utf8'))
    expect(validateVersions(data), JSON.stringify(validateVersions.errors)).toBe(true)
  })

  it("accepts this repository's own versions.json and config", () => {
    expect(validateVersions(readJson('changelog/versions.json'))).toBe(true)
    expect(validateConfig(readJson('changelog.config.json'))).toBe(true)
  })

  it('accepts a full config and rejects typos', () => {
    const { customBump: _c, formatter: _f, ...json } = { ...defaultConfig(), $schema: 'x' }
    expect(validateConfig(json), JSON.stringify(validateConfig.errors)).toBe(true)
    expect(validateConfig({ bumpmode: 'semver' })).toBe(false)
  })
})
