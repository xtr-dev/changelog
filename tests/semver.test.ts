import { describe, expect, it } from 'vitest'

import {
  compareSemver,
  formatSemver,
  inc,
  incPatchBy,
  isValidSemver,
  parseSemver,
} from '../src/semver.js'

describe('semver', () => {
  it('parses plain X.Y.Z', () => {
    expect(parseSemver('1.2.3')).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: [],
      build: [],
    })
  })

  it('strips a leading v', () => {
    expect(parseSemver('v0.0.1').patch).toBe(1)
  })

  it('parses prerelease and build', () => {
    const s = parseSemver('1.0.0-rc.1+build.7')
    expect(s.prerelease).toEqual(['rc', '1'])
    expect(s.build).toEqual(['build', '7'])
    expect(formatSemver(s)).toBe('1.0.0-rc.1+build.7')
  })

  it('rejects invalid', () => {
    expect(isValidSemver('1.2')).toBe(false)
    expect(isValidSemver('foo')).toBe(false)
    expect(() => parseSemver('1.2')).toThrow()
  })

  it('compares', () => {
    expect(compareSemver('1.2.3', '1.2.4')).toBeLessThan(0)
    expect(compareSemver('1.3.0', '1.2.9')).toBeGreaterThan(0)
    expect(compareSemver('2.0.0', '2.0.0')).toBe(0)
    expect(compareSemver('1.0.0-alpha', '1.0.0')).toBeLessThan(0)
    expect(compareSemver('1.0.0-alpha.1', '1.0.0-alpha.2')).toBeLessThan(0)
    expect(compareSemver('1.0.0-alpha.10', '1.0.0-alpha.2')).toBeGreaterThan(0) // numeric
  })

  it('increments', () => {
    expect(inc('1.2.3', 'patch')).toBe('1.2.4')
    expect(inc('1.2.3', 'minor')).toBe('1.3.0')
    expect(inc('1.2.3', 'major')).toBe('2.0.0')
    expect(inc('1.2.3', 'none')).toBe('1.2.3')
    expect(incPatchBy('1.2.3', 4)).toBe('1.2.7')
  })
})
