/**
 * Turn the many spellings of a repository location into a browsable https
 * base URL, or null when it cannot be expressed as one.
 *
 *   git+https://github.com/o/r.git   → https://github.com/o/r
 *   git@github.com:o/r.git           → https://github.com/o/r
 *   ssh://git@gitlab.com/g/o/r.git   → https://gitlab.com/g/o/r
 *   github:o/r  /  o/r               → https://github.com/o/r
 *   { "type": "git", "url": "..." }  → (the url, as above)
 */
export function normalizeRepositoryUrl(input: unknown): string | null {
  const raw =
    typeof input === 'string'
      ? input
      : input && typeof input === 'object' && typeof (input as { url?: unknown }).url === 'string'
        ? (input as { url: string }).url
        : null
  if (!raw) return null
  let s = raw.trim()

  const shorthand = /^(?:(github|gitlab|bitbucket):)?([\w.-]+\/[\w.-]+)$/.exec(s)
  if (shorthand) {
    const host = { github: 'github.com', gitlab: 'gitlab.com', bitbucket: 'bitbucket.org' }[
      (shorthand[1] ?? 'github') as 'github' | 'gitlab' | 'bitbucket'
    ]
    return `https://${host}/${shorthand[2]!.replace(/\.git$/, '')}`
  }

  // scp-like: git@host:path
  const scp = /^[\w.-]+@([\w.-]+):(?!\/\/)(.+)$/.exec(s)
  if (scp) s = `https://${scp[1]}/${scp[2]}`

  s = s.replace(/^git\+/, '')
  let url: URL
  try {
    url = new URL(s)
  } catch {
    return null
  }
  if (!['http:', 'https:', 'ssh:', 'git:'].includes(url.protocol)) return null
  const path = url.pathname.replace(/\.git$/, '').replace(/\/+$/, '')
  if (!path || path === '/') return null
  return `https://${url.hostname}${path}`
}
