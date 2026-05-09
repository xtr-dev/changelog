import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { compareSemver, isValidSemver } from './semver.js'
import type { RawCommit } from './types.js'

const exec = promisify(execFile)

interface GitOptions {
  cwd: string
}

async function git(args: string[], opts: GitOptions): Promise<string> {
  const { stdout } = await exec('git', args, {
    cwd: opts.cwd,
    maxBuffer: 1024 * 1024 * 64,
  })
  return stdout
}

export async function getLastTag(
  opts: GitOptions & { tagPrefix: string },
): Promise<string | null> {
  let raw: string
  try {
    raw = await git(['tag', '--list', `${opts.tagPrefix}*`], opts)
  } catch {
    return null
  }
  const tags = raw
    .split('\n')
    .map((t) => t.trim())
    .filter(Boolean)
  if (tags.length === 0) return null

  // Prefer the highest semver among tags that look like vX.Y.Z.
  const semverTags = tags
    .filter((t) => isValidSemver(t.slice(opts.tagPrefix.length)))
    .sort((a, b) =>
      compareSemver(a.slice(opts.tagPrefix.length), b.slice(opts.tagPrefix.length)),
    )
  if (semverTags.length > 0) return semverTags[semverTags.length - 1]!
  return tags[tags.length - 1]!
}

const DELIMITER = 'COMMIT'
const FIELD = 'FIELD'

export async function getCommitsSince(
  ref: string | null,
  opts: GitOptions,
): Promise<RawCommit[]> {
  const range = ref ? `${ref}..HEAD` : 'HEAD'
  const format = ['%H', '%h', '%an', '%aI', '%s', '%b'].join(FIELD) + DELIMITER

  let raw: string
  try {
    raw = await git(['log', `--format=${format}`, range], opts)
  } catch (err) {
    // No commits yet, or invalid range.
    if ((err as { stderr?: string }).stderr?.includes('unknown revision')) {
      return []
    }
    return []
  }

  const out: RawCommit[] = []
  const records = raw.split(DELIMITER)
  for (const rec of records) {
    const trimmed = rec.replace(/^\n+/, '')
    if (!trimmed.trim()) continue
    const fields = trimmed.split(FIELD)
    if (fields.length < 6) continue
    const [hash, shortHash, author, date, subject, body] = fields
    out.push({
      hash: hash!.trim(),
      shortHash: shortHash!.trim(),
      author: author!.trim(),
      date: date!.trim(),
      subject: (subject ?? '').replace(/\n+$/, ''),
      body: (body ?? '').replace(/\n+$/, ''),
    })
  }
  return out
}

export async function isCleanWorkingTree(opts: GitOptions): Promise<boolean> {
  const out = await git(['status', '--porcelain'], opts)
  return out.trim() === ''
}

export async function stageAndCommit(
  message: string,
  paths: string[],
  opts: GitOptions,
): Promise<void> {
  if (paths.length === 0) return
  await git(['add', '--', ...paths], opts)
  await git(['commit', '-m', message], opts)
}

export async function createTag(
  tag: string,
  message: string,
  opts: GitOptions,
): Promise<void> {
  await git(['tag', '-a', tag, '-m', message], opts)
}

export async function push(
  remote: string,
  branch: string | null,
  opts: GitOptions & { tags?: boolean; followTags?: boolean },
): Promise<void> {
  const args = ['push']
  if (opts.followTags) args.push('--follow-tags')
  args.push(remote)
  if (branch) args.push(branch)
  await git(args, opts)
  if (opts.tags && !opts.followTags) {
    await git(['push', remote, '--tags'], opts)
  }
}

export async function getCurrentBranch(opts: GitOptions): Promise<string | null> {
  try {
    const out = await git(['rev-parse', '--abbrev-ref', 'HEAD'], opts)
    const branch = out.trim()
    return branch === 'HEAD' ? null : branch
  } catch {
    return null
  }
}
