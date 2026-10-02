/**
 * Conventional Commits parser.
 *
 * Handles:
 *   type(scope)!: description
 *   type: description
 *   type(scope): description
 *
 * Body footers we recognize: BREAKING CHANGE, BREAKING-CHANGE, plus arbitrary
 * "Token: value" or "Token #issue" lines (Closes, Refs, Fixes, …).
 *
 * Anything that doesn't match the header pattern is marked unconventional and
 * gets type='other' so the caller can decide whether to drop or include it.
 */

import type { CommitNote, ParsedCommit, RawCommit } from './types.js'

const HEADER_RE =
  /^(?<type>[a-zA-Z][a-zA-Z0-9_-]*)(?:\((?<scope>[^)]+)\))?(?<bang>!)?:\s*(?<description>.+)$/

const FOOTER_TOKEN_RE = /^(?<token>[A-Z][A-Za-z-]+(?:\s[A-Z][A-Za-z-]+)?):\s*(?<value>.+)$/
const FOOTER_HASH_RE = /^(?<token>[A-Z][A-Za-z-]+)\s+#(?<value>\d+)$/

const BREAKING_TITLES = new Set(['BREAKING CHANGE', 'BREAKING-CHANGE', 'BREAKING'])

export function parseCommit(raw: RawCommit): ParsedCommit {
  const subject = raw.subject.trim()
  const isMerge = subject.startsWith('Merge ')
  const isRevert = /^revert[\s(:!]/i.test(subject)

  // git's own revert subject: Revert "feat: thing". Not a conventional header,
  // but it is a real change, so type it as a revert rather than dropping it.
  const gitRevert = /^Revert "(?<inner>.+)"$/.exec(subject)
  if (gitRevert) {
    return {
      raw,
      type: 'revert',
      scope: null,
      description: subject,
      body: raw.body.trim(),
      breaking: false,
      breakingReasons: [],
      notes: [],
      isMerge,
      isRevert: true,
      unconventional: false,
    }
  }

  const m = HEADER_RE.exec(subject)
  if (!m || !m.groups) {
    return {
      raw,
      type: 'other',
      scope: null,
      description: subject,
      body: raw.body.trim(),
      breaking: false,
      breakingReasons: [],
      notes: [],
      isMerge,
      isRevert,
      unconventional: true,
    }
  }

  const { type, scope, bang, description } = m.groups
  const breakingReasons: string[] = []
  if (bang) breakingReasons.push('!')

  const { notes, trimmedBody } = parseBody(raw.body)
  for (const n of notes) {
    if (BREAKING_TITLES.has(n.title.toUpperCase())) {
      breakingReasons.push(n.title)
    }
  }

  return {
    raw,
    type: type!.toLowerCase(),
    scope: scope ? scope.trim() : null,
    description: description!.trim(),
    body: trimmedBody,
    breaking: breakingReasons.length > 0,
    breakingReasons,
    notes,
    isMerge,
    isRevert,
    unconventional: false,
  }
}

function parseBody(body: string): { notes: CommitNote[]; trimmedBody: string } {
  const lines = body.replace(/\r\n/g, '\n').split('\n')
  // Footer block = trailing block of "Token: value" lines separated from the
  // main body by a blank line. Find the last blank line and try to interpret
  // everything after it as footers.
  let lastBlank = -1
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i]!.trim() === '') {
      lastBlank = i
      break
    }
  }
  const footerCandidate = lastBlank >= 0 ? lines.slice(lastBlank + 1) : lines.slice()

  const notes: CommitNote[] = []
  const consumed = new Set<number>()

  for (let i = 0; i < footerCandidate.length; i++) {
    const line = footerCandidate[i]!.trim()
    if (!line) continue
    const tok = FOOTER_TOKEN_RE.exec(line) || FOOTER_HASH_RE.exec(line)
    if (!tok || !tok.groups) {
      // Not a clean footer block — treat the whole "footer candidate" as part
      // of the body and bail.
      return { notes: [], trimmedBody: body.trim() }
    }
    let text = tok.groups.value!.trim()
    // Continuation lines (indented by space) extend the previous note.
    while (i + 1 < footerCandidate.length && /^\s+\S/.test(footerCandidate[i + 1]!)) {
      text += '\n' + footerCandidate[i + 1]!.trim()
      i++
    }
    notes.push({ title: tok.groups.token!.trim(), text })
    consumed.add(i)
  }

  // If we found notes, strip them out of the body.
  if (notes.length > 0 && lastBlank >= 0) {
    const trimmedBody = lines.slice(0, lastBlank).join('\n').trim()
    return { notes, trimmedBody }
  }
  if (notes.length > 0 && lastBlank < 0) {
    return { notes, trimmedBody: '' }
  }
  return { notes: [], trimmedBody: body.trim() }
}

/**
 * Filter helper: cancel reverted pairs, then drop merge commits, unconventional
 * commits, and types excluded by config.
 */
export interface FilterOptions {
  includeTypes: string[] | null
  excludeTypes: string[]
  dropMerges?: boolean
  dropUnconventional?: boolean
}

const REVERTS_RE = /This reverts commit (?<hash>[0-9a-f]{7,40})/

/**
 * Drop a commit and its revert when both fall in the same release: together
 * they are no change at all. A revert of a commit that already shipped is
 * kept, since it does change what users get.
 */
export function cancelReverts(commits: ParsedCommit[]): ParsedCommit[] {
  const dropped = new Set<ParsedCommit>()
  for (const revert of commits) {
    if (!revert.isRevert) continue
    const hash = REVERTS_RE.exec(revert.raw.body)?.groups?.hash
    if (!hash) continue
    const target = commits.find((c) => c !== revert && !dropped.has(c) && c.raw.hash.startsWith(hash))
    if (!target) continue
    dropped.add(target)
    dropped.add(revert)
  }
  return dropped.size === 0 ? commits : commits.filter((c) => !dropped.has(c))
}

export function filterCommits(
  commits: ParsedCommit[],
  opts: FilterOptions,
): ParsedCommit[] {
  const dropMerges = opts.dropMerges ?? true
  const dropUnconventional = opts.dropUnconventional ?? true
  return cancelReverts(commits).filter((c) => {
    if (dropMerges && c.isMerge) return false
    if (dropUnconventional && c.unconventional) return false
    if (opts.includeTypes && !opts.includeTypes.includes(c.type)) return false
    if (opts.excludeTypes.includes(c.type)) return false
    return true
  })
}
