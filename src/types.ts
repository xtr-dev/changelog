export type BumpLevel = 'major' | 'minor' | 'patch' | 'none'
export type BumpMode = 'semver' | 'commit-count' | 'custom'

export interface RawCommit {
  hash: string
  shortHash: string
  author: string
  date: string
  subject: string
  body: string
}

export interface CommitNote {
  /** e.g. 'BREAKING CHANGE', 'Closes', 'Refs' */
  title: string
  text: string
}

export interface ParsedCommit {
  raw: RawCommit
  type: string
  scope: string | null
  description: string
  body: string
  breaking: boolean
  /** Reasons it's a breaking change ('!' marker, BREAKING CHANGE footer) */
  breakingReasons: string[]
  notes: CommitNote[]
  /** True for `Merge ...` commits — usually filtered out before formatting */
  isMerge: boolean
  /** True for `revert: ...` commits */
  isRevert: boolean
  /** Was the commit unparseable as a conventional commit? */
  unconventional: boolean
}

export interface VersionEntryChange {
  type: string
  scope: string | null
  description: string
  commit: string
  author?: string
  breaking: boolean
  notes: CommitNote[]
}

export interface VersionEntryGroups {
  /** Only present if non-empty. */
  breaking?: VersionEntryChange[]
  features?: VersionEntryChange[]
  fixes?: VersionEntryChange[]
  other?: VersionEntryChange[]
  /** User-defined groups via config. */
  [key: string]: VersionEntryChange[] | undefined
}

export interface VersionEntry {
  version: string
  date: string
  /** Short SHA of the last commit included in this release. */
  commit: string | null
  breaking: boolean
  groups: VersionEntryGroups
}

export interface VersionsFile {
  $schema?: string
  schemaVersion: 2
  versions: VersionEntry[]
}

export interface ArchiveFile {
  $schema?: string
  schemaVersion: 2
  versions: VersionEntry[]
}

export interface GroupDef {
  /** Human-readable title used in markdown headings (e.g. 'Features'). */
  title: string
  /** Stable key in versions.json#groups (e.g. 'features'). */
  key: string
  /** Conventional commit types that fall into this group. */
  types: string[]
}

export interface ChangelogConfig {
  /** Bumping strategy. Default 'semver'. */
  bumpMode: BumpMode

  /** Custom bump function used when bumpMode === 'custom'. */
  customBump?: (commits: ParsedCommit[], current: string) => string

  /** Starting version when no prior tags exist. Default '0.0.0'. */
  initialVersion: string

  /** Map commit type → bump level (semver mode). Breaking always wins. */
  bumpMap: Record<string, BumpLevel>

  /** If non-empty, only these types are considered for bumping/output. */
  includeTypes: string[] | null

  /** Always-excluded types (applied after include). */
  excludeTypes: string[]

  /** Groups for output. Order matters — used in markdown sections. */
  groups: GroupDef[]

  /** Output targets — all opt-in. */
  output: {
    versionsJson: { path: string; archivePath: string; archiveAfter: number } | false
    markdown: { path: string; preamble: string } | false
    packageJson: { path: string } | false
  }

  /** Tag prefix. Default 'v'. */
  tagPrefix: string

  /**
   * Override the markdown formatter for a single version entry.
   * Receives the entry; should return markdown for that section
   * (without the top-level # heading).
   */
  formatter?: (entry: VersionEntry) => string
}

export interface ReleaseInput {
  cwd: string
  config: ChangelogConfig
  /** Override "now" — used in tests. */
  now?: Date
  /** Override the current version (otherwise read from package.json or last tag). */
  currentVersionOverride?: string
}

export interface ReleaseResult {
  released: boolean
  previousVersion: string
  /** New version when released; otherwise === previousVersion. */
  version: string
  bumpLevel: BumpLevel
  entry: VersionEntry | null
  /** Files that would be (or were) written. */
  filesWritten: string[]
  /** Commits scanned for this release. */
  commits: ParsedCommit[]
}
