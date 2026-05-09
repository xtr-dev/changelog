import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export interface TempRepo {
  cwd: string
  commit: (subject: string, body?: string, file?: { path: string; content: string }) => string
  tag: (name: string) => void
  cleanup: () => void
}

let counter = 0

export function createTempRepo(): TempRepo {
  const dir = mkdtempSync(join(tmpdir(), 'xtr-changelog-'))

  const run = (args: string[]): string =>
    execFileSync('git', args, {
      cwd: dir,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Test',
        GIT_AUTHOR_EMAIL: 'test@example.com',
        GIT_COMMITTER_NAME: 'Test',
        GIT_COMMITTER_EMAIL: 'test@example.com',
      },
    }).toString()

  run(['init', '-b', 'main'])
  run(['config', 'commit.gpgsign', 'false'])
  run(['config', 'tag.gpgsign', 'false'])
  // Anchor commit. Use a non-conventional message so it doesn't influence
  // any release that scans HEAD..start.
  writeFileSync(join(dir, '.gitkeep'), '')
  run(['add', '.gitkeep'])
  run(['commit', '-m', 'initial'])

  return {
    cwd: dir,
    commit: (subject, body, file) => {
      const fileName = file?.path ?? `f-${++counter}.txt`
      const content = file?.content ?? `${counter}\n`
      writeFileSync(join(dir, fileName), content)
      run(['add', fileName])
      const args = ['commit', '-m', subject]
      if (body) args.push('-m', body)
      run(args)
      return run(['rev-parse', 'HEAD']).trim()
    },
    tag: (name) => {
      run(['tag', '-a', name, '-m', `Release ${name}`])
    },
    cleanup: () => {
      rmSync(dir, { recursive: true, force: true })
    },
  }
}
