# @xtr-dev/changelog

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

This drops a `changelog.config.json` at the repo root with all three outputs (`changelog/versions.json`, `CHANGELOG.md`, and `package.json` bumping) enabled. Edit `output` to opt-out of any. (Without a config file, only `versions.json` is written by default.)

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
Next release: 0.1.0 (minor)
Previous: 0.0.0

  features (1)
    - api: add /healthz endpoint (a1b2c3d)
  fixes (1)
    - cli: handle empty input (e4f5a6b)
  other (1)
    - add README example (7c8d9e0)
```

Nothing has been written yet — `preview` is read-only.

### 5. Cut the release

```bash
# Just write the files (no git ops)
npx xtr-changelog release --execute

# Or do the whole dance: write, commit, tag, push
npx xtr-changelog release --execute --commit --tag --push
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

This prints the *would-be* next entry without writing anything — handy for embedding "what's new" content in your bundle, generating release notes for a PR description, or any other build-time consumer.

> **Defaults at a glance:** `changelog/versions.json` is always on, with rotation past 10 entries into `changelog/archive.json`. Markdown and `package.json` updates are opt-in by default but enabled by `init`. Dry-run is the default; you have to ask for `--execute` to write anything.

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

`changelog.config.json`, `changelog.config.js`/`.mjs`/`.cjs`, or `package.json#changelog`. (TS configs aren't loaded directly — compile or use JSON.)

```ts
import type { ChangelogConfig } from '@xtr-dev/changelog'

export default {
  // 'semver' (default) | 'commit-count' | 'custom'
  bumpMode: 'semver',
  initialVersion: '0.0.0',
  tagPrefix: 'v',

  // Type → bump map (semver mode). Breaking always wins.
  bumpMap: { feat: 'minor', fix: 'patch', perf: 'patch' /* ... */ },

  // Filtering.
  includeTypes: null,         // null = all
  excludeTypes: [],           // exclude after include

  // Output groups (order matters in markdown).
  groups: [
    { title: 'Features', key: 'features', types: ['feat'] },
    { title: 'Fixes',    key: 'fixes',    types: ['fix', 'perf'] },
    { title: 'Other',    key: 'other',    types: ['refactor', 'docs', 'chore', /* ... */] },
  ],

  // Outputs (all opt-in; at least one must be enabled).
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

- **`semver`** — type → level, breaking → major. The expected behavior.
- **`commit-count`** — N release-eligible commits = N patch bumps (`+0.0.N`). Breaking changes still escalate to a single major. Useful for early-stage projects where semantic boundaries aren't worth the bookkeeping.
- **`custom`** — you provide `(commits, current) => nextVersion`.

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

All pure functions live at the top of `src/`: `parseCommit`, `computeNextVersion`, `buildVersionEntry`, `formatVersionMarkdown`, `rotate`. The orchestrator in `release.ts` is a thin I/O shell over them.

## Migration

**From `standard-version`** — point `bumpMap` and `groups` at the same conventional-commits set you're using today. Move your `CHANGELOG.md` aside; this tool builds a fresh one (and you can paste your old entries into `preamble`).

**From `semantic-release`** — if you only used `@semantic-release/commit-analyzer`, `@semantic-release/release-notes-generator`, `@semantic-release/git`, and `@semantic-release/npm`, this tool plus an `npm publish` step does the same job. Plugins beyond that won't have an equivalent.

## License

MIT
