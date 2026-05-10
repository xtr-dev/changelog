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
# Write files, commit, tag, push
npx xtr-changelog release --execute --commit --tag --push

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
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: xtr-dev/changelog@v1
```

Now every push to `main` becomes a release commit + tag. The `[skip ci]` marker on the release commit prevents the workflow from looping.

### 7. Use the structured changelog at build time

```bash
npx xtr-changelog unreleased --json > whats-new.json
```

`unreleased` prints just the version entry as compact JSON — perfect for piping into a bundler or release-notes script. (`preview` is the human-readable cousin; `preview --json` returns the full result envelope, while `unreleased --json` returns only the entry itself.)

## Defaults at a glance

- `changelog/versions.json` is always on, with the 10 most recent entries kept in place and older ones rotated into `changelog/archive.json`.
- Markdown and `package.json` updates are opt-in by default, and turned on by `init`.
- Dry-run is the default — you have to pass `--execute` to write anything. `--commit`, `--tag`, and `--push` each imply `--execute`.
- Color is on when stdout is a TTY. Set `NO_COLOR=1` or pass `--no-color` to disable.

## CLI

```
xtr-changelog <command> [options]

Commands
  preview                     Show what the next release would contain (no writes)
  release                     Apply the release
  unreleased                  Print the would-be next entry as JSON
  init                        Scaffold config

Common options
  --cwd <path>                Working directory
  --json                      Emit JSON
  --no-color                  Disable colored output

Release options
  --execute                   Actually write files
  --commit / --tag / --push   Standard release dance (each implies --execute)
  --remote <name>             Default: origin
  --branch <name>             Default: current branch
  --message <tpl>             Commit message template; {version} is substituted
                              Default: 'chore(release): v{version} [skip ci]'
```

`unreleased --json` is the build-time hook: it prints the next version + grouped changes without writing anything, so your bundler can embed a "what's new" payload.

## Config

Loaded from (in order): `changelog.config.json`, `changelog.config.js`/`.mjs`/`.cjs`, or a `"changelog"` key in `package.json`. TS configs (`changelog.config.ts`) are detected but not transpiled — there's no built-in TS loader, so either compile to `.js`/`.mjs` or use JSON.

```ts
import type { ChangelogConfig } from '@xtr-dev/changelog'

export default {
  // 'semver' (default) | 'commit-count' | 'custom'
  bumpMode: 'semver',
  initialVersion: '0.0.0',
  tagPrefix: 'v',

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
        "features": [{ "type": "feat", "scope": "cli", "description": "...", "commit": "abc1234", "author": "Jane", "breaking": false, "notes": [] }],
        "fixes": [],
        "other": []
      }
    }
  ]
}
```

`archive.json` has the same shape.

## GitHub Action

```yaml
- uses: xtr-dev/changelog@v1
  with:
    push: true
```

All inputs (with defaults):

| input | default | notes |
| --- | --- | --- |
| `node-version` | `20` | |
| `cwd` | `.` | |
| `package-version` | `latest` | npm version of the CLI to install. `local` to use the workspace install. |
| `commit` / `tag` / `push` | `true` | |
| `remote` | `origin` | |
| `branch` | (current) | |
| `message` | `chore(release): v{version} [skip ci]` | |
| `git-user-name` / `git-user-email` | `github-actions[bot]` | |

Outputs: `released`, `version`, `previous-version`, `changes-json`.

The action sets `[skip ci]` in the release commit by default — your `on: push` workflow won't loop.

## Library

```ts
import { preview, release, loadConfig } from '@xtr-dev/changelog'

const config = await loadConfig(process.cwd())
const result = await preview({ cwd: process.cwd(), config })
if (result.released) console.log('next version:', result.version)
```

The high-level entry points are `preview` (read-only) and `release` (does the I/O). Underneath, the pure building blocks are exported too — useful when you're building a custom flow:

| Export | Purpose |
| --- | --- |
| `parseCommit`, `filterCommits` | Parse a git log line into a `ParsedCommit`, then drop ones excluded by `includeTypes`/`excludeTypes`. |
| `computeNextVersion`, `deriveSemverBump` | Decide the next version from parsed commits + current version. |
| `buildVersionEntry` | Turn parsed commits into the structured entry that ends up in `versions.json`. |
| `formatVersionMarkdown`, `buildChangelogMarkdown` | Render one entry, or a full `CHANGELOG.md`, from structured entries. |
| `loadConfig`, `mergeConfig`, `defaultConfig` | Resolve user config against defaults. `DEFAULT_BUMP_MAP` and `DEFAULT_GROUPS` are exported as constants. |
| `parseSemver`, `inc`, `compareSemver`, … | The semver helpers used internally — exported because they're handy and dependency-free. |

## Migration

**From `standard-version`** — point `bumpMap` and `groups` at the same conventional-commits set you're using today. Move your `CHANGELOG.md` aside; this tool builds a fresh one (and you can paste your old entries into `output.markdown.preamble`).

**From `semantic-release`** — if you only used `@semantic-release/commit-analyzer`, `@semantic-release/release-notes-generator`, `@semantic-release/git`, and `@semantic-release/npm`, this tool plus an `npm publish` step does the same job. Plugins beyond that (Slack, JIRA, custom analyzers, etc.) won't have an equivalent.

**From `conventional-changelog` / `conventional-changelog-cli`** — same input format, so commits don't need to change. The big difference is that this tool bumps the version *and* writes the changelog in one step, and ships the structured `versions.json` alongside the markdown.

**From `changesets`** — different model entirely. Changesets is intent-based (you write a changeset file describing the bump); this tool is commit-driven (it infers from conventional-commit prefixes). If you're a single-package repo and your team already writes conventional commits, you can drop the per-PR changeset overhead. For monorepos with independent package versioning, stick with changesets.

## Troubleshooting

- **"No commits found" / wrong base.** The tool walks back to the most recent tag matching `tagPrefix` (default `v`). In CI, make sure tags are present — `actions/checkout@v4` needs `with: { fetch-depth: 0 }` (a shallow clone has no tags).
- **The release commit triggers another release run.** The default commit message includes `[skip ci]`, but only the `if:` guard in your workflow actually stops it. Keep the `if: "!contains(github.event.head_commit.message, '[skip ci]')"` line, or set `message` to something else and update the guard to match.
- **Signed commits in CI.** The action commits as `github-actions[bot]` and does not sign. If your branch protection requires signed commits, run the release on a branch that allows unsigned commits, or set `commit: false` and sign/push from a separate step.
- **`bumpMode: 'custom'` errors.** `customBump` must return a valid semver string. Return the *same* version as `current` to skip the release (no entry written, no commit, no tag).
- **Nothing happens on `release` without `--execute`.** That's by design — the default is dry-run. Pass `--execute`, or any of `--commit` / `--tag` / `--push` (each implies `--execute`).

## License

MIT
