# @xtr-dev/changelog

[![npm version](https://img.shields.io/npm/v/@xtr-dev/changelog.svg)](https://www.npmjs.com/package/@xtr-dev/changelog)
[![npm downloads](https://img.shields.io/npm/dm/@xtr-dev/changelog.svg)](https://www.npmjs.com/package/@xtr-dev/changelog)
[![license](https://img.shields.io/npm/l/@xtr-dev/changelog.svg)](https://github.com/xtr-dev/changelog/blob/main/LICENSE)

Conventional-commits-driven release tool. Every push to your release branch becomes a version bump and a changelog entry.

Library + CLI + GitHub Action. ESM, Node ≥ 20, zero runtime dependencies.

## Quick start

A 60-second tour from zero to a first release.

### 1. Install

```bash
npm i -D @xtr-dev/changelog
```

### 2. Scaffold a config

```bash
npx xtr-changelog init
```

This drops a `changelog.config.json` at the repo root that turns on all three outputs: `changelog/versions.json`, `CHANGELOG.md`, and `package.json` bumping. Edit `output` to opt out of any. (Without a config file at all, only `versions.json` is written.)

### 3. Make a few conventional commits

```bash
git commit --allow-empty -m "feat(api): add /healthz endpoint"
git commit --allow-empty -m "fix(cli): handle empty input"
git commit --allow-empty -m "docs: add README example"
```

### 4. Preview what the next release would contain

```bash
npx xtr-changelog preview
```

You'll see something like:

```
▸ next release  0.0.0 → 0.1.0 (minor)

  Features (1)
    • api: add /healthz endpoint (a1b2c3d)

  Fixes (1)
    • cli: handle empty input (e4f5a6b)

  Other (1)
    • add README example (7c8d9e0)
```

Nothing has been written yet — `preview` is read-only.

### 5. Cut the release

```bash
# Write files, commit, tag, push (--push implies --tag, which implies --commit)
npx xtr-changelog release --push

# Or just write the files (no git ops)
npx xtr-changelog release --execute
```

After this you'll have:

- `changelog/versions.json` — the structured entry, ready to import at build time.
- `CHANGELOG.md` — Keep-a-Changelog style markdown (if `output.markdown` is enabled).
- `package.json` bumped to the new version (if `output.packageJson` is enabled).
- A `chore(release): v0.1.0 [skip ci]` commit and a `v0.1.0` tag (if `--commit --tag` were passed).

### 6. Wire it into CI

In `.github/workflows/release.yml`:

```yaml
name: Release
on:
  push:
    branches: [main]

permissions:
  contents: write

jobs:
  release:
    if: "!contains(github.event.head_commit.message, '[skip ci]')"
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
        with: { fetch-depth: 0 }
      - uses: xtr-dev/changelog@v0
        with:
          github-release: true   # optional: also publish a GitHub Release
```

Now every push to `main` becomes a release commit + tag. The `[skip ci]` marker on the release commit prevents the workflow from looping. `@v0` is a moving tag on the latest 0.x release; pin an exact release tag (e.g. `@v0.0.12`) if you prefer.

### 7. Use the structured changelog at build time

```bash
npx xtr-changelog unreleased --json > whats-new.json
```

`unreleased` prints just the version entry as compact JSON — perfect for piping into a bundler or release-notes script. (`preview` is the human-readable cousin; `preview --json` returns the full result envelope, while `unreleased --json` returns only the entry itself.)

## Defaults at a glance

- `changelog/versions.json` is always on, with the 10 most recent entries kept in place and older ones rotated into `changelog/archive.json`.
- Markdown and `package.json` updates are opt-in by default, and turned on by `init`. Bumping `package.json` also bumps the root version in a sibling `package-lock.json`.
- `CHANGELOG.md` links commits, issues and version comparisons when the repository URL is known (from `package.json#repository` or the `origin` remote).
- Unknown config keys and unknown CLI flags are errors, not silently ignored.
- Dry-run is the default — you have to pass `--execute` to write anything. `--commit`, `--tag`, and `--push` each imply `--execute`.
- Color is on when stdout is a TTY. Set `NO_COLOR=1` or pass `--no-color` to disable.

## CLI

```
xtr-changelog <command> [options]

Commands
  preview                     Show what the next release would contain (no writes)
  release                     Apply the release
  unreleased                  Print the would-be next entry as JSON
  notes [version]             Print a release's notes as markdown (default: newest)
  init                        Scaffold config

Common options
  --cwd <path>                Working directory
  --json                      Emit JSON
  --no-color                  Disable colored output
  -v, --version               Print the xtr-changelog version

Versioning options (preview, unreleased, release)
  --preid <id>                Cut a pre-release, e.g. beta → 1.3.0-beta.0
  --release-as <version>      Release exactly this version (e.g. 1.0.0)

Release options
  --execute                   Actually write files
  --commit                    Create a release commit (implies --execute)
  --tag                       Create an annotated tag (implies --commit)
  --push                      Push commit + tag (implies --tag)
  --remote <name>             Default: origin
  --branch <name>             Default: current branch
  --message <tpl>             Commit message template; {version} is substituted
                              Default: 'chore(release): v{version} [skip ci]'
```

`unreleased --json` is the build-time hook: it prints the next version + grouped changes without writing anything, so your bundler can embed a "what's new" payload. `notes` prints an already-released version's section without its heading, ready for a GitHub Release body.

Flags are strict: a misspelled flag (`--exceute`) or one that doesn't apply to the command (`preview --push`) exits with an error.

## Config

Loaded from (in order): `changelog.config.ts` (detected but refused — there's no built-in TS loader, so compile to `.js`/`.mjs` or use JSON), `changelog.config.js`/`.mjs`/`.cjs`, `changelog.config.json`, or a `"changelog"` key in `package.json`.

The config is validated when loaded: unknown keys (`bumpmode`) and wrong types (`bumpMap: { feat: 'huge' }`) fail with every problem listed. JSON configs can point at the published schema for editor completion — `init` adds this for you:

```json
{ "$schema": "https://unpkg.com/@xtr-dev/changelog/schema/config.schema.json" }
```

```ts
import type { ChangelogConfig } from '@xtr-dev/changelog'

export default {
  // 'semver' (default) | 'commit-count' | 'custom'
  bumpMode: 'semver',
  initialVersion: '0.0.0',
  tagPrefix: 'v',

  // Release commits matching this template never count toward a release.
  releaseCommitMessage: 'chore(release): v{version} [skip ci]',

  // Pre-releases: 'beta' → 1.3.0-beta.0, 1.3.0-beta.1, …; unset for stable.
  // prerelease: 'beta',

  // Before 1.0.0, treat breaking changes as minor bumps. Default false.
  bumpMinorPreMajor: false,

  // Base URL for links in CHANGELOG.md. Detected from package.json#repository
  // or the origin remote when unset; false turns links off.
  // repositoryUrl: 'https://github.com/you/repo',

  // Only count commits touching these paths (monorepo packages). Default: all.
  // paths: ['packages/a'],

  // Type → bump map (semver mode). Breaking always wins (→ major).
  // Defaults shown — anything not listed is ignored for bump purposes.
  bumpMap: {
    feat: 'minor',
    fix: 'patch', perf: 'patch', refactor: 'patch', revert: 'patch',
    docs: 'patch', style: 'patch', test: 'patch',
    build: 'patch', ci: 'patch', chore: 'patch',
    a11y: 'patch', i18n: 'patch', security: 'patch',
  },

  // Filtering.
  includeTypes: null,         // null = all
  excludeTypes: [],           // exclude after include

  // Output groups (order matters in markdown). Defaults shown.
  groups: [
    { title: 'Features', key: 'features', types: ['feat'] },
    { title: 'Fixes',    key: 'fixes',    types: ['fix', 'perf'] },
    {
      title: 'Other', key: 'other',
      types: ['refactor', 'docs', 'style', 'test', 'build', 'ci',
              'chore', 'revert', 'a11y', 'i18n', 'security'],
    },
  ],

  // Outputs. versionsJson is always written; the others are opt-in.
  output: {
    versionsJson: { path: 'changelog/versions.json', archivePath: 'changelog/archive.json', archiveAfter: 10 },
    markdown:     false,                                            // or { path: 'CHANGELOG.md', preamble: '...' }
    packageJson:  false,                                            // or { path: 'package.json' }
  },

  // Custom one-version-section formatter (markdown).
  // formatter: (entry) => string,
} satisfies ChangelogConfig
```

### Where the previous version comes from

In precedence order:

1. `currentVersionOverride`, if you pass it to the library.
2. The highest `tagPrefix`-matching tag *reachable from HEAD* (default prefix `v`). Tags on other branches are ignored, so a hotfix on `main` isn't based on a `v2.0.0` that only exists on `next`.
3. Otherwise, the highest of `package.json#version` (read even when `output.packageJson` is off) and the newest `versions.json` entry.
4. Otherwise `initialVersion` (default `0.0.0`).

The commits considered are the ones since that tag. Without a tag, they're the ones since the commit the newest `versions.json` entry records, so an untagged repo doesn't re-release its whole history every time (if that commit has been rewritten away, the CLI warns and scans everything). Release commits — anything matching `releaseCommitMessage` — never count.

Step 3 is what keeps untagged repos monotonic: `versions.json` is written on every release, so it works as the anchor even when tags are absent (a shallow CI clone) and `output.packageJson` is off. Disable *both* of those outputs and there is nowhere left to record the version — every run then re-stamps the same one, and the CLI warns you.

### Bump modes

- **`semver`** (default) — type → level via `bumpMap`, breaking → major. The expected behavior.
- **`commit-count`** — N release-eligible commits = N patch bumps (`+0.0.N`). Breaking changes still escalate to a single major. Useful for early-stage projects where semantic boundaries aren't worth the bookkeeping.
- **`custom`** — supply your own `customBump`:

  ```ts
  export default {
    bumpMode: 'custom',
    customBump: (commits, current) => {
      // commits: ParsedCommit[], current: string (e.g. '1.2.3')
      // return the next semver string
      return commits.some((c) => c.scope === 'api') ? '1.3.0' : '1.2.4'
    },
  } satisfies ChangelogConfig
  ```

A commit and its revert in the same release cancel out. A revert of something that already shipped (including git's default `Revert "feat: …"` subject) counts as a `revert` (patch by default).

### Pre-releases

```bash
npx xtr-changelog release --push --preid beta   # 1.2.3 + feat → 1.3.0-beta.0
npx xtr-changelog release --push --preid beta   # more changes  → 1.3.0-beta.1
npx xtr-changelog release --push                # graduate      → 1.3.0
```

A pre-release line absorbs bumps up to the level it already represents: a breaking change on `1.3.0-beta.1` starts `2.0.0-beta.0`, a fix just advances the counter. Set `prerelease: 'beta'` in config for a branch that always cuts pre-releases.

### Leaving 0.x

By default a breaking change on 0.x jumps to 1.0.0. Set `bumpMinorPreMajor: true` to keep breaking changes on the minor while the major is 0, then go stable explicitly:

```bash
npx xtr-changelog release --push --release-as 1.0.0
```

`--release-as` releases exactly that version, even when no commit would trigger a bump. It must be greater than the current version.

### Monorepos

Release one package at a time with `paths` and a per-package `tagPrefix`. Run it from the package directory:

```json
{ "tagPrefix": "pkg-a@v", "paths": ["."], "releaseCommitMessage": "chore(release): pkg-a@v{version} [skip ci]" }
```

```bash
npx xtr-changelog release --cwd packages/a --push
```

Only commits touching `packages/a` count, tags look like `pkg-a@v1.2.0`, and the outputs are resolved relative to the package. For coordinated multi-package releases, changesets is still a better fit.

## `CHANGELOG.md`

```markdown
## [0.4.2](https://github.com/o/r/compare/v0.4.1...v0.4.2) - 2026-05-09

### Breaking
- **api:** remove legacy fields ([deadbee](https://github.com/o/r/commit/deadbee…))
  The v1 endpoints are gone; use /v2.

### Features
- **cli:** support --json output ([#12](https://github.com/o/r/issues/12)) ([abc1234](https://github.com/o/r/commit/abc1234…)), closes [#9](https://github.com/o/r/issues/9)
```

- Breaking changes are listed once, under **Breaking**, with their `BREAKING CHANGE:` note.
- `#123` in a description and `Closes`/`Fixes`/`Refs` footers become issue links. Links need a repository URL; without one the same text is rendered unlinked.
- With `versionsJson` on, the file is re-rendered from `versions.json` + `archive.json` on each release, so edit entries there. With `versionsJson` off, the new section is inserted above the newest one and the rest of the file is left untouched.
- `config.formatter(entry)` replaces the per-version rendering entirely.

## `versions.json` schema

```jsonc
{
  "schemaVersion": 2,
  "versions": [
    {
      "version": "0.4.2",
      "date": "2026-05-09",
      "commit": "abc1234",
      "breaking": false,
      "groups": {
        "features": [{ "type": "feat", "scope": "cli", "description": "...", "commit": "abc1234", "hash": "abc1234…(40 chars)", "author": "Jane", "breaking": false, "notes": [] }],
        "fixes": [],
        "other": []
      }
    }
  ]
}
```

`archive.json` has the same shape. Both validate against [`schema/versions.schema.json`](schema/versions.schema.json), published at `https://unpkg.com/@xtr-dev/changelog/schema/versions.schema.json`.

## GitHub Action

```yaml
permissions:
  contents: write

steps:
  - uses: actions/checkout@v6
    with: { fetch-depth: 0 }
  - uses: xtr-dev/changelog@v0
    id: release
    with:
      github-release: true
  - if: steps.release.outputs.released == 'true'
    run: echo "released ${{ steps.release.outputs.version }}"
```

All inputs (with defaults):

| input | default | notes |
| --- | --- | --- |
| `node-version` | `22` | |
| `cwd` | `.` | |
| `package-version` | (the action's own version) | npm version of the CLI to install. `local` uses the workspace install (`npx --no-install`). |
| `commit` / `tag` / `push` | `true` | |
| `remote` | `origin` | |
| `branch` | (current) | |
| `message` | `chore(release): v{version} [skip ci]` | |
| `preid` | | Cut a pre-release, e.g. `beta`. |
| `release-as` | | Release exactly this version. |
| `github-release` | `false` | Create a GitHub Release with the entry as notes. Needs `tag` and `push`. Marked as a pre-release for `-beta.N` style versions. |
| `github-token` | `github.token` | Used for the GitHub Release. |
| `git-user-name` / `git-user-email` | `github-actions[bot]` | |

Outputs: `released`, `version`, `previous-version`, `tag`, `changes-json`, `release-url`.

The action sets `[skip ci]` in the release commit by default — your `on: push` workflow won't loop. Inputs are passed to the scripts as environment variables, so values with quotes or `$(...)` are safe.

## Library

```ts
import { preview, release, loadConfig } from '@xtr-dev/changelog'

const config = await loadConfig(process.cwd())
const result = await preview({ cwd: process.cwd(), config })
if (result.released) console.log('next version:', result.version)

// Write files, then commit, tag and push (each step implies the ones before it).
await release({ cwd: process.cwd(), config, git: { push: true } })
```

The high-level entry points are `preview` (read-only), `release` (writes files, and runs the git steps in `git`), and `releaseNotes` (markdown for a recorded version). `preview` and `release` also take `preid` and `releaseAs`. Underneath, the pure building blocks are exported too — useful when you're building a custom flow:

| Export | Purpose |
| --- | --- |
| `parseCommit`, `filterCommits`, `cancelReverts` | Parse a git log line into a `ParsedCommit`, cancel reverted pairs, then drop ones excluded by `includeTypes`/`excludeTypes`. |
| `computeNextVersion`, `deriveSemverBump` | Decide the next version from parsed commits + current version. |
| `buildVersionEntry` | Turn parsed commits into the structured entry that ends up in `versions.json`. |
| `formatVersionMarkdown`, `buildChangelogMarkdown`, `insertChangelogSection` | Render one entry, a full `CHANGELOG.md`, or insert one entry into an existing file. |
| `normalizeRepositoryUrl` | Turn `git@github.com:o/r.git`, `github:o/r`, etc. into a browsable `https://` base URL. |
| `loadConfig`, `mergeConfig`, `defaultConfig` | Resolve user config against defaults. `DEFAULT_BUMP_MAP` and `DEFAULT_GROUPS` are exported as constants. |
| `parseSemver`, `inc`, `compareSemver`, … | The semver helpers used internally — exported because they're handy and dependency-free. |

## Migration

**From `standard-version`** — point `bumpMap` and `groups` at the same conventional-commits set you're using today. Move your `CHANGELOG.md` aside; this tool builds a fresh one (and you can paste your old entries into `output.markdown.preamble`).

**From `semantic-release`** — if you only used `@semantic-release/commit-analyzer`, `@semantic-release/release-notes-generator`, `@semantic-release/git`, and `@semantic-release/npm`, this tool plus an `npm publish` step does the same job. Plugins beyond that (Slack, JIRA, custom analyzers, etc.) won't have an equivalent.

**From `conventional-changelog` / `conventional-changelog-cli`** — same input format, so commits don't need to change. The big difference is that this tool bumps the version *and* writes the changelog in one step, and ships the structured `versions.json` alongside the markdown.

**From `changesets`** — different model entirely. Changesets is intent-based (you write a changeset file describing the bump); this tool is commit-driven (it infers from conventional-commit prefixes). If you're a single-package repo and your team already writes conventional commits, you can drop the per-PR changeset overhead. For monorepos, `paths` + a per-package `tagPrefix` covers releasing packages independently (see [Monorepos](#monorepos)); for coordinated multi-package releases, stick with changesets.

## Troubleshooting

- **"No commits found" / wrong base.** The tool walks back to the highest tag matching `tagPrefix` (default `v`) that is reachable from HEAD. In CI, make sure tags are present — `actions/checkout` needs `with: { fetch-depth: 0 }` (a shallow clone has no tags).
- **The same version keeps getting released.** The previous version comes from the most recent `tagPrefix` tag. With no such tag — a shallow CI clone, or a repo that doesn't tag — it falls back to the highest version recorded by an enabled output: `package.json#version` or the newest entry in `versions.json`. If neither of those outputs is enabled, nothing persists the version and every run re-stamps the same one; the CLI prints a warning to stderr when it detects this. Fix it by enabling `output.versionsJson` or `output.packageJson`, tagging releases (`--tag`), or passing `currentVersionOverride`.
- **The release commit triggers another release run.** The default commit message includes `[skip ci]`, but only the `if:` guard in your workflow actually stops it. Keep the `if: "!contains(github.event.head_commit.message, '[skip ci]')"` line, or set `message` to something else and update the guard to match.
- **Signed commits in CI.** The action commits as `github-actions[bot]` and does not sign. If your branch protection requires signed commits, run the release on a branch that allows unsigned commits, or set `commit: false` and sign/push from a separate step.
- **`bumpMode: 'custom'` errors.** `customBump` must return a valid semver string. Return the *same* version as `current` to skip the release (no entry written, no commit, no tag).
- **`unknown option` / `does not apply to`.** Flags are checked strictly; run `xtr-changelog help` for the flags each command takes.
- **Nothing happens on `release` without `--execute`.** That's by design — the default is dry-run. Pass `--execute`, or any of `--commit` / `--tag` / `--push` (each implies `--execute`).

## Development

```bash
npm ci
npm run check          # lint (Biome) + typecheck (src and tests) + tests
npm run test:coverage
npm run build
```

## License

MIT
