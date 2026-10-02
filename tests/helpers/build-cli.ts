import { rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { build } from 'tsup'

/** Where the test build of the CLI lands; one level below the repo root so
 * that cli.js finds ../package.json exactly as it does from dist/. */
export const TEST_DIST = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.test-dist')

export async function setup(): Promise<void> {
  await build({
    config: false,
    entry: { cli: 'src/cli.ts' },
    format: ['esm'],
    target: 'node20',
    platform: 'node',
    outDir: TEST_DIST,
    clean: true,
    dts: false,
    silent: true,
  })
}

export function teardown(): void {
  rmSync(TEST_DIST, { recursive: true, force: true })
}
