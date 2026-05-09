import { describe, expect, it } from 'vitest'

import { computeNextVersion, deriveSemverBump, maxBump } from '../src/bump.js'
import { defaultConfig } from '../src/config.js'
import { parseCommit } from '../src/parse.js'
import type { ChangelogConfig, ParsedCommit, RawCommit } from '../src/types.js'

const raw = (subject: string, body = ''): RawCommit => ({
  hash: 'h',
  shortHash: 'h',
  author: 'A',
  date: '',
  subject,
  body,
})
const c = (s: string, body = ''): ParsedCommit => parseCommit(raw(s, body))

describe('maxBump', () => {
  it('returns the higher level', () => {
    expect(maxBump('patch', 'minor')).toBe('minor')
    expect(maxBump('major', 'minor')).toBe('major')
    expect(maxBump('none', 'patch')).toBe('patch')
  })
})

describe('deriveSemverBump', () => {
  const cfg = defaultConfig()
  it('returns none for empty', () => {
    expect(deriveSemverBump([], cfg.bumpMap)).toBe('none')
  })
  it('feat → minor', () => {
    expect(deriveSemverBump([c('feat: x')], cfg.bumpMap)).toBe('minor')
  })
  it('fix → patch', () => {
    expect(deriveSemverBump([c('fix: x')], cfg.bumpMap)).toBe('patch')
  })
  it('breaking → major', () => {
    expect(deriveSemverBump([c('feat!: x')], cfg.bumpMap)).toBe('major')
    expect(
      deriveSemverBump([c('fix: x', 'BREAKING CHANGE: nope')], cfg.bumpMap),
    ).toBe('major')
  })
  it('takes the max', () => {
    expect(
      deriveSemverBump([c('fix: x'), c('feat: y'), c('docs: z')], cfg.bumpMap),
    ).toBe('minor')
  })
})

describe('computeNextVersion - semver mode', () => {
  const cfg = defaultConfig()
  it('no commits → no release', () => {
    expect(computeNextVersion('1.0.0', [], cfg)).toEqual({ next: '1.0.0', level: 'none' })
  })
  it('feat from 0.1.0 → 0.2.0', () => {
    expect(computeNextVersion('0.1.0', [c('feat: x')], cfg)).toEqual({
      next: '0.2.0',
      level: 'minor',
    })
  })
  it('breaking change always → major', () => {
    expect(computeNextVersion('1.2.3', [c('feat!: x')], cfg)).toEqual({
      next: '2.0.0',
      level: 'major',
    })
  })
})

describe('computeNextVersion - commit-count mode', () => {
  const cfg: ChangelogConfig = { ...defaultConfig(), bumpMode: 'commit-count' }
  it('4 commits = +0.0.4', () => {
    const cs = [c('feat: a'), c('fix: b'), c('docs: c'), c('chore: d')]
    expect(computeNextVersion('0.0.0', cs, cfg)).toEqual({
      next: '0.0.4',
      level: 'patch',
    })
  })
  it('breaking still escalates to a single major', () => {
    const cs = [c('feat: a'), c('fix!: nope'), c('docs: c')]
    expect(computeNextVersion('1.2.3', cs, cfg)).toEqual({
      next: '2.0.0',
      level: 'major',
    })
  })
  it('zero commits → no release', () => {
    expect(computeNextVersion('1.2.3', [], cfg)).toEqual({ next: '1.2.3', level: 'none' })
  })
})

describe('computeNextVersion - custom mode', () => {
  it('uses customBump when provided', () => {
    const cfg: ChangelogConfig = {
      ...defaultConfig(),
      bumpMode: 'custom',
      customBump: () => '9.9.9',
    }
    expect(computeNextVersion('1.0.0', [c('feat: x')], cfg)).toEqual({
      next: '9.9.9',
      level: 'major',
    })
  })
  it('rejects invalid output', () => {
    const cfg: ChangelogConfig = {
      ...defaultConfig(),
      bumpMode: 'custom',
      customBump: () => 'not-a-version',
    }
    expect(() => computeNextVersion('1.0.0', [c('feat: x')], cfg)).toThrow(/invalid semver/i)
  })
})
