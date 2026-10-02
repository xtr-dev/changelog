import { describe, expect, it } from 'vitest'

import { normalizeRepositoryUrl } from '../src/repository.js'

describe('normalizeRepositoryUrl', () => {
  it.each([
    ['git+https://github.com/xtr-dev/changelog.git', 'https://github.com/xtr-dev/changelog'],
    ['https://github.com/o/r', 'https://github.com/o/r'],
    ['https://github.com/o/r/', 'https://github.com/o/r'],
    ['git@github.com:o/r.git', 'https://github.com/o/r'],
    ['ssh://git@gitlab.com/group/o/r.git', 'https://gitlab.com/group/o/r'],
    ['https://user:token@github.com/o/r.git', 'https://github.com/o/r'],
    ['github:o/r', 'https://github.com/o/r'],
    ['gitlab:o/r', 'https://gitlab.com/o/r'],
    ['o/r', 'https://github.com/o/r'],
    [{ type: 'git', url: 'git+https://github.com/o/r.git' }, 'https://github.com/o/r'],
  ])('%j → %s', (input, expected) => {
    expect(normalizeRepositoryUrl(input)).toBe(expected)
  })

  it.each([[null], [''], ['not a url'], [{ type: 'git' }], ['file:///tmp/repo']])(
    'returns null for %j',
    (input) => {
      expect(normalizeRepositoryUrl(input)).toBeNull()
    },
  )
})
