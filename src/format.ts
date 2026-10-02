import type {
  ChangelogConfig,
  ParsedCommit,
  VersionEntry,
  VersionEntryChange,
  VersionEntryGroups,
} from './types.js'

/**
 * Build a VersionEntry from parsed commits. Pure — no I/O. The caller decides
 * the version string and date (so tests can inject "now").
 */
export function buildVersionEntry(args: {
  version: string
  date: string
  commits: ParsedCommit[]
  config: ChangelogConfig
}): VersionEntry {
  const { version, date, commits, config } = args
  const groups: VersionEntryGroups = {}

  // Build a type → group key map from config.groups, plus a fallback.
  const typeToGroup = new Map<string, string>()
  for (const g of config.groups) {
    for (const t of g.types) typeToGroup.set(t, g.key)
  }

  const breakingChanges: VersionEntryChange[] = []

  for (const c of commits) {
    const change: VersionEntryChange = {
      type: c.type,
      scope: c.scope,
      description: c.description,
      commit: c.raw.shortHash,
      ...(c.raw.hash ? { hash: c.raw.hash } : {}),
      ...(c.raw.author ? { author: c.raw.author } : {}),
      breaking: c.breaking,
      notes: c.notes,
    }
    if (c.breaking) breakingChanges.push(change)

    const key = typeToGroup.get(c.type) ?? 'other'
    if (!groups[key]) groups[key] = []
    groups[key]!.push(change)
  }

  if (breakingChanges.length > 0) groups.breaking = breakingChanges

  // Reorder groups to match config order (with breaking always first if present).
  const ordered: VersionEntryGroups = {}
  if (groups.breaking) ordered.breaking = groups.breaking
  for (const g of config.groups) {
    if (groups[g.key] && g.key !== 'breaking') ordered[g.key] = groups[g.key]
  }
  // Append any unknown keys (e.g. 'other' fallback) that didn't appear in config.
  for (const k of Object.keys(groups)) {
    if (!(k in ordered)) ordered[k] = groups[k]
  }

  const commit = commits.length > 0 ? (commits[0]!.raw.shortHash) : null

  return {
    version,
    date,
    commit,
    breaking: breakingChanges.length > 0,
    groups: ordered,
  }
}

/**
 * Default markdown formatter. Returns the section for one version, in
 * Keep-a-Changelog style, without the document-level title.
 *
 *     ## [0.4.2](https://github.com/o/r/compare/v0.4.1...v0.4.2) - 2026-05-09
 *
 *     ### Breaking
 *     - **api:** removed legacy fields ([deadbee](https://github.com/o/r/commit/deadbee...))
 *
 *     ### Features
 *     - **cli:** support --json output ([abc1234](https://github.com/o/r/commit/abc1234...)), closes [#12](https://github.com/o/r/issues/12)
 *
 * Links are added only when config.repositoryUrl is set (it is detected from
 * package.json#repository or the origin remote by loadConfig). The compare
 * link needs the previous version, which the document builders pass in.
 */
export function formatVersionMarkdown(
  entry: VersionEntry,
  config: ChangelogConfig,
  previousVersion?: string,
): string {
  if (config.formatter) return config.formatter(entry)

  const repo = config.repositoryUrl || null
  const lines: string[] = []
  const tag = (v: string) => `${config.tagPrefix}${v}`
  const heading =
    repo && previousVersion
      ? `[${entry.version}](${repo}/compare/${tag(previousVersion)}...${tag(entry.version)})`
      : `[${entry.version}]`
  lines.push(`## ${heading} - ${entry.date}`)

  const groupOrder: Array<{ key: string; title: string }> = []
  if (entry.groups.breaking) groupOrder.push({ key: 'breaking', title: 'Breaking' })
  for (const g of config.groups) {
    if (g.key === 'breaking') continue
    if (entry.groups[g.key]) groupOrder.push({ key: g.key, title: g.title })
  }
  // Trail any custom groups not in config.
  for (const k of Object.keys(entry.groups)) {
    if (!groupOrder.some((g) => g.key === k)) {
      groupOrder.push({ key: k, title: titleCase(k) })
    }
  }

  for (const g of groupOrder) {
    // Breaking changes are listed under Breaking; repeating them in their
    // type's group too would list them twice.
    const items = (entry.groups[g.key] ?? []).filter(
      (item) => g.key === 'breaking' || !item.breaking || !entry.groups.breaking,
    )
    if (items.length === 0) continue
    lines.push('')
    lines.push(`### ${g.title}`)
    for (const item of items) {
      lines.push(`- ${formatChangeLine(item, repo, g.key === 'breaking')}`)
    }
  }

  return lines.join('\n') + '\n'
}

const BREAKING_NOTE_TITLES = new Set(['BREAKING CHANGE', 'BREAKING-CHANGE', 'BREAKING'])
const ISSUE_NOTE_TITLES = new Set(['closes', 'close', 'closed', 'fixes', 'fix', 'fixed', 'resolves', 'resolve', 'resolved', 'refs', 'ref'])

function formatChangeLine(c: VersionEntryChange, repo: string | null, inBreaking: boolean): string {
  const scope = c.scope ? `**${c.scope}:** ` : ''
  const breaking = c.breaking && !inBreaking ? ' ⚠️' : ''
  const description = repo ? linkIssues(c.description, repo) : c.description
  // Entries written before full hashes were stored still link: hosts resolve
  // an unambiguous short hash too.
  const commit = repo ? `[${c.commit}](${repo}/commit/${c.hash ?? c.commit})` : c.commit
  let line = `${scope}${description}${breaking} (${commit})`

  const refs = (c.notes ?? [])
    .filter((n) => ISSUE_NOTE_TITLES.has(n.title.toLowerCase()))
    .flatMap((n) => [...n.text.matchAll(/#?(\d+)/g)].map((m) => ({ verb: n.title.toLowerCase(), id: m[1]! })))
  for (const ref of refs) {
    const verb = ref.verb.startsWith('ref') ? 'refs' : 'closes'
    line += repo ? `, ${verb} [#${ref.id}](${repo}/issues/${ref.id})` : `, ${verb} #${ref.id}`
  }

  if (inBreaking) {
    for (const note of c.notes ?? []) {
      if (!BREAKING_NOTE_TITLES.has(note.title.toUpperCase())) continue
      for (const text of note.text.split('\n')) line += `\n  ${text}`
    }
  }
  return line
}

/** Link bare `#123` references (as squash merges write them) to the issue. */
function linkIssues(text: string, repo: string): string {
  return text.replace(/(^|[\s(])#(\d+)\b/g, (_m, pre: string, id: string) => `${pre}[#${id}](${repo}/issues/${id})`)
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/**
 * Build a complete CHANGELOG.md document from the active versions list.
 * Inserts the optional preamble between the H1 and the first version.
 */
export function buildChangelogMarkdown(
  versions: VersionEntry[],
  config: ChangelogConfig,
  preamble?: string,
): string {
  const parts: string[] = []
  parts.push('# Changelog\n')
  if (preamble && preamble.trim()) {
    parts.push(preamble.trim() + '\n')
  }
  versions.forEach((v, i) => {
    parts.push(formatVersionMarkdown(v, config, versions[i + 1]?.version))
  })
  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
}

/**
 * Insert one version's section into an existing CHANGELOG.md, above the newest
 * existing version and below the title and any preamble. Everything already in
 * the file is kept verbatim. With no existing file, builds a fresh document.
 */
export function insertChangelogSection(
  existing: string | null,
  entry: VersionEntry,
  config: ChangelogConfig,
): string {
  const preamble =
    typeof config.output.markdown === 'object' ? config.output.markdown.preamble : ''
  if (existing === null || !existing.trim()) {
    return buildChangelogMarkdown([entry], config, preamble)
  }
  const previous = /^## \[([^\]]+)\]/m.exec(existing)?.[1]
  const section = formatVersionMarkdown(entry, config, previous).trimEnd() + '\n'
  const firstVersion = /^## /m.exec(existing)
  if (!firstVersion) {
    return existing.trimEnd() + '\n\n' + section
  }
  const before = existing.slice(0, firstVersion.index)
  const after = existing.slice(firstVersion.index)
  return before + section + '\n' + after
}
