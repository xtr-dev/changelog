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
import { c, colorGroup, colorLevel, setColor, sym } from './pretty.js'
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

function helpText(): string {
  const h = (s: string) => c.bold(c.cyan(s))
  const cmd = (s: string) => c.green(s)
  const flag = (s: string) => c.yellow(s)
  return [
    `${c.bold('xtr-changelog')} ${c.dim('—')} conventional-commits-driven releases`,
    '',
    h('Usage'),
    `  xtr-changelog ${cmd('<command>')} ${flag('[options]')}`,
    '',
    h('Commands'),
    `  ${cmd('preview')}                     Show what the next release would contain (no writes)`,
    `  ${cmd('release')}                     Apply the release`,
    `  ${cmd('unreleased')}                  Print the would-be next entry as JSON`,
    `  ${cmd('init')}                        Scaffold config`,
    `  ${cmd('help')}                        Show this help`,
    '',
    h('Common options'),
    `  ${flag('--cwd')} <path>                Working directory (default: process.cwd)`,
    `  ${flag('--json')}                      Emit JSON instead of human-readable text`,
    `  ${flag('--no-color')}                  Disable colored output`,
    '',
    h('Release options'),
    `  ${flag('--execute')}                   Actually write files (default: dry-run)`,
    `  ${flag('--commit')}                    Create a release commit (implies --execute)`,
    `  ${flag('--tag')}                       Create an annotated tag (implies --execute)`,
    `  ${flag('--push')}                      Push commit + tag (implies --execute, --commit, --tag)`,
    `  ${flag('--remote')} <name>             Remote to push to (default: origin)`,
    `  ${flag('--branch')} <name>             Branch to push (default: current branch)`,
    `  ${flag('--message')} <tpl>             Commit message template; {version} is substituted`,
    '',
    h('Exit codes'),
    `  ${c.green('0')}  success (released or nothing to do)`,
    `  ${c.red('1')}  error`,
    '',
  ].join('\n')
}

function fail(msg: string, code = 1): never {
  stderr.write(`${c.red(sym.cross)} ${c.bold('xtr-changelog')}: ${msg}\n`)
  exit(code)
}

async function main(): Promise<void> {
  const parsed = parseArgs(argv.slice(2))
  const cwd = resolve(
    typeof parsed.flags.cwd === 'string' ? parsed.flags.cwd : processCwd(),
  )
  const json = parsed.flags.json === true
  const command = parsed.command

  // Color discipline: JSON output and --no-color always disable.
  // Beyond that, defer to the TTY/NO_COLOR/FORCE_COLOR detection in pretty.ts.
  if (json || parsed.flags['no-color'] === true) {
    setColor(false)
  }

  if (command === 'help' || command === '--help' || command === '-h') {
    stdout.write(helpText())
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
        stdout.write(c.dim(`${sym.arrow} dry run — pass `) + c.yellow('--execute') + c.dim(' to write files\n\n'))
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
      else stdout.write(`${c.dim(sym.arrow)} ${c.dim('nothing to release')}\n`)
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
      printReleaseSuccess(result, { committed: wantCommit, tagged: wantTag, pushed: wantPush, tagPrefix: config.tagPrefix })
    }
    return
  }

  fail(`unknown command: ${command}`)
}

function printHumanPreview(result: Awaited<ReturnType<typeof runPreview>>): void {
  if (!result.released || !result.entry) {
    stdout.write(`${c.dim(sym.arrow)} ${c.dim('no release')} ${c.gray('— current version')} ${c.bold(result.previousVersion)}\n`)
    if (result.commits.length > 0) {
      stdout.write(c.dim(`  ${result.commits.length} commits scanned, none triggered a bump\n`))
    }
    return
  }
  const arrow = c.dim('→')
  stdout.write(
    `${c.bold(c.cyan(sym.arrow + ' next release'))}  ` +
      `${c.dim(result.previousVersion)} ${arrow} ${c.bold(c.cyan(result.version))} ` +
      `${c.gray('(')}${colorLevel(result.bumpLevel)}${c.gray(')')}\n\n`,
  )
  for (const [key, items] of Object.entries(result.entry.groups)) {
    if (!items || items.length === 0) continue
    stdout.write(`  ${colorGroup(key)} ${c.dim(`(${items.length})`)}\n`)
    for (const item of items) {
      const scope = item.scope ? c.magenta(item.scope) + c.dim(': ') : ''
      const breaking = item.breaking ? ` ${c.red(sym.warn)}` : ''
      const hash = c.dim(`(${item.commit})`)
      stdout.write(`    ${c.dim(sym.bullet)} ${scope}${item.description}${breaking} ${hash}\n`)
    }
    stdout.write('\n')
  }
}

function printReleaseSuccess(
  result: Awaited<ReturnType<typeof runRelease>>,
  opts: { committed: boolean; tagged: boolean; pushed: boolean; tagPrefix: string },
): void {
  const arrow = c.dim('→')
  stdout.write(
    `${c.green(sym.check)} ${c.bold('released')} ` +
      `${c.dim(result.previousVersion)} ${arrow} ${c.bold(c.green(result.version))} ` +
      `${c.gray('(')}${colorLevel(result.bumpLevel)}${c.gray(')')}\n`,
  )
  for (const f of result.filesWritten) {
    stdout.write(`  ${c.dim(sym.bullet)} ${c.dim('wrote')} ${f}\n`)
  }
  if (opts.committed) stdout.write(`  ${c.dim(sym.bullet)} ${c.dim('commit')}\n`)
  if (opts.tagged) stdout.write(`  ${c.dim(sym.bullet)} ${c.dim('tag')} ${c.cyan(opts.tagPrefix + result.version)}\n`)
  if (opts.pushed) stdout.write(`  ${c.dim(sym.bullet)} ${c.dim('pushed')}\n`)
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
  stdout.write(`${c.green(sym.check)} ${c.dim('wrote')} ${cfgPath}\n`)
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err)
  stderr.write(`xtr-changelog: ${msg}\n`)
  exit(1)
})
