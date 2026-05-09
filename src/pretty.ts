/**
 * Tiny ANSI color helpers. Zero deps.
 *
 * Disabled when:
 *   - stdout is not a TTY
 *   - NO_COLOR is set (https://no-color.org/)
 *   - FORCE_COLOR=0
 *   - --no-color flag was passed (caller decides via setColor)
 *
 * Enabled by default in TTYs. FORCE_COLOR=1/2/3 forces on.
 */

import { stdout } from 'node:process'

let enabled = detectColor()

function detectColor(): boolean {
  const env = process.env
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') return false
  if (env.FORCE_COLOR === '0') return false
  if (env.FORCE_COLOR && env.FORCE_COLOR !== '0') return true
  return Boolean(stdout.isTTY)
}

export function setColor(on: boolean): void {
  enabled = on
}

export function isColorEnabled(): boolean {
  return enabled
}

const wrap = (open: number, close: number) => (s: string) =>
  enabled ? `\x1b[${open}m${s}\x1b[${close}m` : s

export const c = {
  bold: wrap(1, 22),
  dim: wrap(2, 22),
  italic: wrap(3, 23),
  underline: wrap(4, 24),

  red: wrap(31, 39),
  green: wrap(32, 39),
  yellow: wrap(33, 39),
  blue: wrap(34, 39),
  magenta: wrap(35, 39),
  cyan: wrap(36, 39),
  gray: wrap(90, 39),

  bgRed: wrap(41, 49),
  bgGreen: wrap(42, 49),
  bgYellow: wrap(43, 49),
}

/** Symbols. Falls back to ASCII when color is off (for CI log readability). */
export const sym = {
  get bullet() {
    return enabled ? '•' : '*'
  },
  get arrow() {
    return enabled ? '▸' : '>'
  },
  get check() {
    return enabled ? '✓' : 'OK'
  },
  get cross() {
    return enabled ? '✗' : 'X'
  },
  get warn() {
    return enabled ? '⚠' : '!'
  },
  get rocket() {
    return enabled ? '🚀' : '*'
  },
}

/** Color a bump level by severity. */
export function colorLevel(level: string): string {
  switch (level) {
    case 'major':
      return c.red(c.bold(level))
    case 'minor':
      return c.yellow(level)
    case 'patch':
      return c.green(level)
    case 'none':
      return c.dim(level)
    default:
      return level
  }
}

/** Color a group key consistently. */
export function colorGroup(key: string): string {
  switch (key) {
    case 'breaking':
      return c.red(c.bold('Breaking'))
    case 'features':
      return c.green('Features')
    case 'fixes':
      return c.cyan('Fixes')
    case 'other':
      return c.gray('Other')
    default:
      return c.magenta(key.charAt(0).toUpperCase() + key.slice(1))
  }
}
