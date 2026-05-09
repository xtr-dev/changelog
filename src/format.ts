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
 *     ## [0.4.2] - 2026-05-09
 *
 *     ### Breaking
 *     - **api:** removed legacy fields (deadbee)
 *
 *     ### Features
 *     - **cli:** support --json output (abc123)
 */
export function formatVersionMarkdown(
  entry: VersionEntry,
  config: ChangelogConfig,
): string {
  if (config.formatter) return config.formatter(entry)

  const lines: string[] = []
  lines.push(`## [${entry.version}] - ${entry.date}`)

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
    const items = entry.groups[g.key]
    if (!items || items.length === 0) continue
    lines.push('')
    lines.push(`### ${g.title}`)
    for (const item of items) {
      lines.push(`- ${formatChangeLine(item)}`)
    }
  }

  return lines.join('\n') + '\n'
}

function formatChangeLine(c: VersionEntryChange): string {
  const scope = c.scope ? `**${c.scope}:** ` : ''
  const breaking = c.breaking ? ' ⚠️' : ''
  return `${scope}${c.description}${breaking} (${c.commit})`
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
  for (const v of versions) {
    parts.push(formatVersionMarkdown(v, config))
  }
  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
}
