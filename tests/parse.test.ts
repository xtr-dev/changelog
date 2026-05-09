import { describe, expect, it } from 'vitest'

import { filterCommits, parseCommit } from '../src/parse.js'
import type { RawCommit } from '../src/types.js'

const raw = (subject: string, body = ''): RawCommit => ({
  hash: 'a'.repeat(40),
  shortHash: 'abc1234',
  author: 'Test',
  date: '2026-05-09T12:00:00Z',
  subject,
  body,
})

describe('parseCommit', () => {
  it('parses type-only header', () => {
    const c = parseCommit(raw('feat: add thing'))
    expect(c.type).toBe('feat')
    expect(c.scope).toBeNull()
    expect(c.description).toBe('add thing')
    expect(c.breaking).toBe(false)
    expect(c.unconventional).toBe(false)
  })

  it('parses scope', () => {
    const c = parseCommit(raw('fix(cli): handle missing arg'))
    expect(c.type).toBe('fix')
    expect(c.scope).toBe('cli')
  })

  it('detects bang as breaking', () => {
    const c = parseCommit(raw('feat(api)!: drop legacy field'))
    expect(c.breaking).toBe(true)
    expect(c.breakingReasons).toEqual(['!'])
  })

  it('detects BREAKING CHANGE footer', () => {
    const c = parseCommit(
      raw(
        'feat: change shape',
        'Some body explaining things.\n\nBREAKING CHANGE: rename `foo` to `bar`',
      ),
    )
    expect(c.breaking).toBe(true)
    expect(c.notes.find((n) => n.title === 'BREAKING CHANGE')?.text).toContain('rename')
  })

  it('parses Closes #123 footer', () => {
    const c = parseCommit(raw('fix: leak', 'body\n\nCloses #123'))
    expect(c.notes).toEqual([{ title: 'Closes', text: '123' }])
  })

  it('preserves multi-line footer text', () => {
    const c = parseCommit(
      raw(
        'feat: x',
        'body\n\nBREAKING CHANGE: foo\n  with continuation',
      ),
    )
    const note = c.notes.find((n) => n.title === 'BREAKING CHANGE')
    expect(note?.text).toContain('continuation')
  })

  it('flags unconventional commits', () => {
    const c = parseCommit(raw('Just a free-form message'))
    expect(c.unconventional).toBe(true)
    expect(c.type).toBe('other')
  })

  it('detects merge commits', () => {
    const c = parseCommit(raw('Merge pull request #42 from foo/bar'))
    expect(c.isMerge).toBe(true)
  })

  it('detects revert commits', () => {
    const c = parseCommit(raw('revert: feat: bad idea'))
    expect(c.isRevert).toBe(true)
  })

  it('lowercases type', () => {
    expect(parseCommit(raw('FEAT: yelling')).type).toBe('feat')
  })
})

describe('filterCommits', () => {
  const make = (subject: string) => parseCommit(raw(subject))

  it('drops merges by default', () => {
    const cs = [make('feat: x'), make('Merge pull request #1')]
    expect(filterCommits(cs, { includeTypes: null, excludeTypes: [] })).toHaveLength(1)
  })

  it('drops unconventional by default', () => {
    const cs = [make('feat: x'), make('whatever'), make('fix: y')]
    expect(filterCommits(cs, { includeTypes: null, excludeTypes: [] })).toHaveLength(2)
  })

  it('honors excludeTypes', () => {
    const cs = [make('feat: x'), make('chore: y')]
    expect(
      filterCommits(cs, { includeTypes: null, excludeTypes: ['chore'] }),
    ).toHaveLength(1)
  })

  it('honors includeTypes', () => {
    const cs = [make('feat: x'), make('fix: y'), make('docs: z')]
    expect(
      filterCommits(cs, { includeTypes: ['feat'], excludeTypes: [] }),
    ).toHaveLength(1)
  })
})
