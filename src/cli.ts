import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { argv, cwd as processCwd, exit, stderr, stdout } from 'node:process'

import { loadConfig } from './config.js'
import {
  createTag,
  getCurrentBranch,
  isCleanWorkingTree,
  push as gitPush,
  stageAndCommit,
} from './git.js'
import { preview as runPreview, release as runRelease } from './release.js'

interface ParsedArgs {
  command: string
  flags: Record<string, string | boolean>
  positionals: string[]
}

function parseArgs(args: string[]): ParsedArgs {
  const [command = 'help', ...rest] = args
  const flags: Record<string, string | boolean> = {}
  const positionals: string[] = []
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!
    if (a === '--') {
      positionals.push(...rest.slice(i + 1))
      break
    }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=')
      if (eq >= 0) {
        flags[a.slice(2, eq)] = a.slice(eq + 1)
      } else {
        const next = rest[i + 1]
        if (next && !next.startsWith('-')) {
          flags[a.slice(2)] = next
          i++
        } else {
          flags[a.slice(2)] = true
        }
      }
    } else if (a.startsWith('-') && a.length > 1) {
      flags[a.slice(1)] = true
    } else {
      positionals.push(a)
    }
  }
  return { command, flags, positionals }
}

const HELP = `xtr-changelog — conventional-commits-driven releases

Usage:
  xtr-changelog <command> [options]

Commands:
  preview                     Show what the next release would contain (no writes)
  release                     Apply the release
  unreleased                  Print the would-be next entry as JSON
  init                        Scaffold config and changelog/ directory
  help                        Show this help

Common options:
  --cwd <path>                Working directory (default: process.cwd)
  --json                      Emit JSON instead of human-readable text

Release options:
  --execute                   Actually write files (default: dry-run)
  --commit                    Create a release commit (implies --execute)
  --tag                       Create an annotated tag (implies --execute)
  --push                      Push commit + tag (implies --execute, --commit, --tag)
  --remote <name>             Remote to push to (default: origin)
  --branch <name>             Branch to push (default: current branch)
  --message <tpl>             Commit message template; {version} is substituted

Exit codes:
  0  success (released or nothing to do)
  1  error
`

function fail(msg: string, code = 1): never {
  stderr.write(`xtr-changelog: ${msg}\n`)
  exit(code)
}

async function main(): Promise<void> {
  const parsed = parseArgs(argv.slice(2))
  const cwd = resolve(
    typeof parsed.flags.cwd === 'string' ? parsed.flags.cwd : processCwd(),
  )
  const json = parsed.flags.json === true
  const command = parsed.command

  if (command === 'help' || command === '--help' || command === '-h') {
    stdout.write(HELP)
    return
  }

  if (command === 'init') {
    await cmdInit(cwd)
    return
  }

  const config = await loadConfig(cwd)

  if (command === 'preview') {
    const result = await runPreview({ cwd, config })
    if (json) {
      stdout.write(JSON.stringify(result, null, 2) + '\n')
    } else {
      printHumanPreview(result)
    }
    return
  }

  if (command === 'unreleased') {
    const result = await runPreview({ cwd, config })
    if (!result.released || !result.entry) {
      stdout.write(JSON.stringify({ released: false }) + '\n')
      return
    }
    if (json) {
      stdout.write(JSON.stringify(result.entry, null, 2) + '\n')
    } else {
      stdout.write(JSON.stringify(result.entry) + '\n')
    }
    return
  }

  if (command === 'release') {
    const wantPush = parsed.flags.push === true
    const wantTag = parsed.flags.tag === true || wantPush
    const wantCommit = parsed.flags.commit === true || wantTag
    const execute = parsed.flags.execute === true || wantCommit

    if (!execute) {
      const result = await runPreview({ cwd, config })
      if (json) {
        stdout.write(JSON.stringify(result, null, 2) + '\n')
      } else {
        stdout.write('Dry run (pass --execute to write files).\n\n')
        printHumanPreview(result)
      }
      return
    }

    if (wantCommit && !(await isCleanWorkingTree({ cwd }))) {
      fail('working tree must be clean before --commit/--tag/--push')
    }

    const result = await runRelease({ cwd, config })
    if (!result.released || !result.entry) {
      if (json) stdout.write(JSON.stringify(result, null, 2) + '\n')
      else stdout.write('Nothing to release.\n')
      return
    }

    if (wantCommit) {
      const tpl =
        typeof parsed.flags.message === 'string'
          ? parsed.flags.message
          : 'chore(release): v{version} [skip ci]'
      const message = tpl.replace(/\{version\}/g, result.version)
      await stageAndCommit(message, result.filesWritten, { cwd })
    }
    if (wantTag) {
      const tagName = `${config.tagPrefix}${result.version}`
      await createTag(tagName, `Release ${tagName}`, { cwd })
    }
    if (wantPush) {
      const remote =
        typeof parsed.flags.remote === 'string' ? parsed.flags.remote : 'origin'
      const branch =
        typeof parsed.flags.branch === 'string'
          ? parsed.flags.branch
          : await getCurrentBranch({ cwd })
      await gitPush(remote, branch, { cwd, followTags: true })
    }

    if (json) {
      stdout.write(JSON.stringify(result, null, 2) + '\n')
    } else {
      stdout.write(`Released ${result.version} (was ${result.previousVersion}, ${result.bumpLevel})\n`)
      for (const f of result.filesWritten) stdout.write(`  wrote ${f}\n`)
    }
    return
  }

  fail(`unknown command: ${command}`)
}

function printHumanPreview(result: Awaited<ReturnType<typeof runPreview>>): void {
  if (!result.released || !result.entry) {
    stdout.write(`No release. Current version: ${result.previousVersion}\n`)
    if (result.commits.length > 0) {
      stdout.write(`(${result.commits.length} commits scanned, none triggered a bump)\n`)
    }
    return
  }
  stdout.write(`Next release: ${result.version} (${result.bumpLevel})\n`)
  stdout.write(`Previous: ${result.previousVersion}\n\n`)
  for (const [key, items] of Object.entries(result.entry.groups)) {
    if (!items || items.length === 0) continue
    stdout.write(`  ${key} (${items.length})\n`)
    for (const c of items) {
      const scope = c.scope ? `${c.scope}: ` : ''
      stdout.write(`    - ${scope}${c.description} (${c.commit})\n`)
    }
  }
}

async function cmdInit(cwd: string): Promise<void> {
  const cfgPath = join(cwd, 'changelog.config.json')
  if (existsSync(cfgPath)) {
    fail('changelog.config.json already exists')
  }
  const cfg = {
    bumpMode: 'semver',
    output: {
      versionsJson: {
        path: 'changelog/versions.json',
        archivePath: 'changelog/archive.json',
        archiveAfter: 10,
      },
      markdown: { path: 'CHANGELOG.md', preamble: '' },
      packageJson: { path: 'package.json' },
    },
  }
  await writeFile(cfgPath, JSON.stringify(cfg, null, 2) + '\n', 'utf8')
  stdout.write(`Wrote ${cfgPath}\n`)
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err)
  stderr.write(`xtr-changelog: ${msg}\n`)
  exit(1)
})
