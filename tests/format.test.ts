import { describe, expect, it } from 'vitest'

import { defaultConfig } from '../src/config.js'
import { buildChangelogMarkdown, buildVersionEntry, formatVersionMarkdown } from '../src/format.js'
import { parseCommit } from '../src/parse.js'
import type { ChangelogConfig, ParsedCommit, RawCommit } from '../src/types.js'

let n = 0
const raw = (subject: string, body = ''): RawCommit => ({
  hash: 'h'.repeat(40),
  shortHash: `s${++n}`,
  author: 'Author',
  date: '2026-05-09T00:00:00Z',
  subject,
  body,
})
const c = (s: string, body = ''): ParsedCommit => parseCommit(raw(s, body))

describe('buildVersionEntry', () => {
  const cfg = defaultConfig()
  it('groups commits by config groups', () => {
    const entry = buildVersionEntry({
      version: '0.2.0',
      date: '2026-05-09',
      commits: [c('feat: a'), c('fix(cli): b'), c('chore: c')],
      config: cfg,
    })
    expect(entry.groups.features?.length).toBe(1)
    expect(entry.groups.fixes?.length).toBe(1)
    expect(entry.groups.other?.length).toBe(1)
    expect(entry.groups.fixes?.[0]?.scope).toBe('cli')
    expect(entry.breaking).toBe(false)
  })

  it('flags breaking entries and adds breaking group', () => {
    const entry = buildVersionEntry({
      version: '1.0.0',
      date: '2026-05-09',
      commits: [c('feat!: x')],
      config: cfg,
    })
    expect(entry.breaking).toBe(true)
    expect(entry.groups.breaking?.length).toBe(1)
  })
})

describe('formatVersionMarkdown', () => {
  const cfg = defaultConfig()
  it('emits Keep-a-Changelog style sections', () => {
    const entry = buildVersionEntry({
      version: '0.2.0',
      date: '2026-05-09',
      commits: [c('feat(api): support websockets'), c('fix: leak')],
      config: cfg,
    })
    const md = formatVersionMarkdown(entry, cfg)
    expect(md).toContain('## [0.2.0] - 2026-05-09')
    expect(md).toContain('### Features')
    expect(md).toContain('### Fixes')
    expect(md).toContain('**api:** support websockets')
  })

  it('honors custom formatter', () => {
    const cfgWithFmt: ChangelogConfig = {
      ...cfg,
      formatter: (e) => `CUSTOM ${e.version}`,
    }
    const entry = buildVersionEntry({
      version: '1.0.0',
      date: '2026-05-09',
      commits: [c('feat: x')],
      config: cfgWithFmt,
    })
    expect(formatVersionMarkdown(entry, cfgWithFmt)).toBe('CUSTOM 1.0.0')
  })
})

describe('buildChangelogMarkdown', () => {
  it('builds full doc with H1 and preamble', () => {
    const cfg = defaultConfig()
    const e1 = buildVersionEntry({
      version: '0.2.0',
      date: '2026-05-09',
      commits: [c('feat: a')],
      config: cfg,
    })
    const e2 = buildVersionEntry({
      version: '0.1.0',
      date: '2026-05-08',
      commits: [c('feat: b')],
      config: cfg,
    })
    const md = buildChangelogMarkdown([e1, e2], cfg, 'All notable changes.')
    expect(md).toMatch(/^# Changelog/)
    expect(md).toContain('All notable changes.')
    expect(md.indexOf('0.2.0')).toBeLessThan(md.indexOf('0.1.0'))
  })
})
