import { existsSync, readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { argv, cwd as processCwd, exit, stderr, stdout } from 'node:process'
import { parseArgs as parseNodeArgs } from 'node:util'

import { loadConfig } from './config.js'
import { c, colorGroup, colorLevel, setColor, sym } from './pretty.js'
import { preview as runPreview, release as runRelease, releaseNotes } from './release.js'

const OPTIONS = {
  cwd: { type: 'string' },
  json: { type: 'boolean' },
  'no-color': { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
  preid: { type: 'string' },
  'release-as': { type: 'string' },
  execute: { type: 'boolean' },
  commit: { type: 'boolean' },
  tag: { type: 'boolean' },
  push: { type: 'boolean' },
  remote: { type: 'string' },
  branch: { type: 'string' },
  message: { type: 'string' },
} as const

type OptionName = keyof typeof OPTIONS

const COMMON: OptionName[] = ['cwd', 'json', 'no-color', 'help', 'version']
const VERSIONING: OptionName[] = ['preid', 'release-as']
const COMMAND_OPTIONS: Record<string, OptionName[]> = {
  preview: [...COMMON, ...VERSIONING],
  unreleased: [...COMMON, ...VERSIONING],
  release: [
    ...COMMON,
    ...VERSIONING,
    'execute',
    'commit',
    'tag',
    'push',
    'remote',
    'branch',
    'message',
  ],
  notes: COMMON,
  init: COMMON,
  help: COMMON,
}

interface ParsedArgs {
  command: string
  flags: { [K in OptionName]?: (typeof OPTIONS)[K]['type'] extends 'string' ? string : boolean }
  positionals: string[]
}

function parseArgs(args: string[]): ParsedArgs {
  // Strict: an unknown or misspelled flag (`--exceute`) is an error rather
  // than a silent dry run.
  const { values, positionals } = parseNodeArgs({
    args,
    options: OPTIONS,
    allowPositionals: true,
    strict: true,
  })
  const [command = values.version ? 'version' : 'help', ...rest] = positionals
  const flags = values as ParsedArgs['flags']
  const allowed = COMMAND_OPTIONS[command]
  if (allowed) {
    for (const name of Object.keys(flags) as OptionName[]) {
      if (!allowed.includes(name)) {
        throw new Error(`option --${name} does not apply to "${command}"`)
      }
    }
  }
  return { command, flags, positionals: rest }
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
    `  ${cmd('notes')} [version]             Print a release's notes as markdown (default: newest)`,
    `  ${cmd('init')}                        Scaffold config`,
    `  ${cmd('help')}                        Show this help`,
    '',
    h('Common options'),
    `  ${flag('--cwd')} <path>                Working directory (default: process.cwd)`,
    `  ${flag('--json')}                      Emit JSON instead of human-readable text`,
    `  ${flag('--no-color')}                  Disable colored output`,
    `  ${flag('-v, --version')}               Print the xtr-changelog version`,
    '',
    h('Versioning options') + c.dim(' (preview, unreleased, release)'),
    `  ${flag('--preid')} <id>                Cut a pre-release, e.g. beta → 1.3.0-beta.0`,
    `  ${flag('--release-as')} <version>      Release exactly this version (e.g. 1.0.0)`,
    '',
    h('Release options'),
    `  ${flag('--execute')}                   Actually write files (default: dry-run)`,
    `  ${flag('--commit')}                    Create a release commit (implies --execute)`,
    `  ${flag('--tag')}                       Create an annotated tag (implies --commit)`,
    `  ${flag('--push')}                      Push commit + tag (implies --tag)`,
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

function packageVersion(): string {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    version: string
  }
  return pkg.version
}

function fail(msg: string, code = 1): never {
  stderr.write(`${c.red(sym.cross)} ${c.bold('xtr-changelog')}: ${msg}\n`)
  exit(code)
}

async function main(): Promise<void> {
  // `xtr-changelog preview | head` closes stdout early; that is not an error.
  stdout.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EPIPE') exit(0)
    throw err
  })

  let parsed: ParsedArgs
  try {
    parsed = parseArgs(argv.slice(2))
  } catch (err) {
    fail(`${err instanceof Error ? err.message : String(err)} (see xtr-changelog help)`)
  }
  const { command, flags } = parsed
  const cwd = resolve(flags.cwd ?? processCwd())
  const json = flags.json === true

  // Color discipline: JSON output and --no-color always disable.
  // Beyond that, defer to the TTY/NO_COLOR/FORCE_COLOR detection in pretty.ts.
  if (json || flags['no-color'] === true) {
    setColor(false)
  }

  if (command === 'version' || flags.version) {
    stdout.write(packageVersion() + '\n')
    return
  }

  if (command === 'help' || flags.help) {
    stdout.write(helpText())
    return
  }

  if (!(command in COMMAND_OPTIONS)) {
    fail(`unknown command: ${command} (see xtr-changelog help)`)
  }
  const maxPositionals = command === 'notes' ? 1 : 0
  if (parsed.positionals.length > maxPositionals) {
    fail(`unexpected argument: ${parsed.positionals[maxPositionals]}`)
  }

  if (command === 'init') {
    await cmdInit(cwd)
    return
  }

  const config = await loadConfig(cwd)
  if (flags.message !== undefined) config.releaseCommitMessage = flags.message
  const versioning = {
    ...(flags.preid !== undefined ? { preid: flags.preid } : {}),
    ...(flags['release-as'] !== undefined ? { releaseAs: flags['release-as'] } : {}),
  }

  if (command === 'notes') {
    const notes = await releaseNotes({
      cwd,
      config,
      ...(parsed.positionals[0] ? { version: parsed.positionals[0] } : {}),
    })
    if (!notes) {
      fail(
        parsed.positionals[0]
          ? `no release ${parsed.positionals[0]} recorded`
          : 'no releases recorded',
      )
    }
    stdout.write(json ? JSON.stringify(notes, null, 2) + '\n' : notes.markdown)
    return
  }

  if (command === 'preview') {
    const result = await runPreview({ cwd, config, ...versioning })
    printWarnings(result.warnings)
    if (json) {
      stdout.write(JSON.stringify(result, null, 2) + '\n')
    } else {
      printHumanPreview(result)
    }
    return
  }

  if (command === 'unreleased') {
    const result = await runPreview({ cwd, config, ...versioning })
    printWarnings(result.warnings)
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

  // release
  const wantPush = flags.push === true
  const wantTag = flags.tag === true || wantPush
  const wantCommit = flags.commit === true || wantTag
  const execute = flags.execute === true || wantCommit

  if (!execute) {
    const result = await runPreview({ cwd, config, ...versioning })
    printWarnings(result.warnings)
    if (json) {
      stdout.write(JSON.stringify(result, null, 2) + '\n')
    } else {
      stdout.write(
        c.dim(`${sym.arrow} dry run — pass `) +
          c.yellow('--execute') +
          c.dim(' to write files\n\n'),
      )
      printHumanPreview(result)
    }
    return
  }

  const result = await runRelease({
    cwd,
    config,
    ...versioning,
    git: {
      commit: wantCommit,
      tag: wantTag,
      push: wantPush,
      ...(flags.remote !== undefined ? { remote: flags.remote } : {}),
      ...(flags.branch !== undefined ? { branch: flags.branch } : {}),
    },
  })
  printWarnings(result.warnings)
  if (!result.released || !result.entry) {
    if (json) stdout.write(JSON.stringify(result, null, 2) + '\n')
    else stdout.write(`${c.dim(sym.arrow)} ${c.dim('nothing to release')}\n`)
    return
  }

  if (json) {
    stdout.write(JSON.stringify(result, null, 2) + '\n')
  } else {
    printReleaseSuccess(result)
  }
}

/**
 * Warnings go to stderr so they are visible even in --json mode, where stdout
 * carries a payload something downstream is parsing.
 */
function printWarnings(warnings: string[]): void {
  for (const w of warnings) {
    stderr.write(`${c.yellow(sym.warn)} ${c.yellow('warning')}: ${w}\n`)
  }
}

function printHumanPreview(result: Awaited<ReturnType<typeof runPreview>>): void {
  if (!result.released || !result.entry) {
    stdout.write(
      `${c.dim(sym.arrow)} ${c.dim('no release')} ${c.gray('— current version')} ${c.bold(result.previousVersion)}\n`,
    )
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
  const hasBreakingGroup = Boolean(result.entry.groups.breaking?.length)
  for (const [key, all] of Object.entries(result.entry.groups)) {
    // Breaking changes are shown once, under Breaking.
    const items = (all ?? []).filter((i) => key === 'breaking' || !i.breaking || !hasBreakingGroup)
    if (items.length === 0) continue
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

function printReleaseSuccess(result: Awaited<ReturnType<typeof runRelease>>): void {
  const arrow = c.dim('→')
  stdout.write(
    `${c.green(sym.check)} ${c.bold('released')} ` +
      `${c.dim(result.previousVersion)} ${arrow} ${c.bold(c.green(result.version))} ` +
      `${c.gray('(')}${colorLevel(result.bumpLevel)}${c.gray(')')}\n`,
  )
  for (const f of result.filesWritten) {
    stdout.write(`  ${c.dim(sym.bullet)} ${c.dim('wrote')} ${f}\n`)
  }
  if (result.git.committed) stdout.write(`  ${c.dim(sym.bullet)} ${c.dim('commit')}\n`)
  if (result.git.tag)
    stdout.write(`  ${c.dim(sym.bullet)} ${c.dim('tag')} ${c.cyan(result.git.tag)}\n`)
  if (result.git.pushed) stdout.write(`  ${c.dim(sym.bullet)} ${c.dim('pushed')}\n`)
}

async function cmdInit(cwd: string): Promise<void> {
  const cfgPath = join(cwd, 'changelog.config.json')
  if (existsSync(cfgPath)) {
    fail('changelog.config.json already exists')
  }
  const cfg = {
    $schema: 'https://unpkg.com/@xtr-dev/changelog/schema/config.schema.json',
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
  fail(err instanceof Error ? err.message : String(err))
})
