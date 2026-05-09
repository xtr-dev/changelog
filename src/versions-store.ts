import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import type { ArchiveFile, VersionEntry, VersionsFile } from './types.js'

const SCHEMA_URL =
  'https://unpkg.com/@xtr-dev/changelog/schema/versions.schema.json'

export function emptyVersionsFile(): VersionsFile {
  return { $schema: SCHEMA_URL, schemaVersion: 2, versions: [] }
}

export function emptyArchiveFile(): ArchiveFile {
  return { $schema: SCHEMA_URL, schemaVersion: 2, versions: [] }
}

export async function readVersionsFile(path: string): Promise<VersionsFile> {
  if (!existsSync(path)) return emptyVersionsFile()
  const raw = await readFile(path, 'utf8')
  if (!raw.trim()) return emptyVersionsFile()
  const parsed = JSON.parse(raw) as unknown
  return normalizeVersionsFile(parsed)
}

export async function readArchiveFile(path: string): Promise<ArchiveFile> {
  if (!existsSync(path)) return emptyArchiveFile()
  const raw = await readFile(path, 'utf8')
  if (!raw.trim()) return emptyArchiveFile()
  const parsed = JSON.parse(raw) as unknown
  return normalizeVersionsFile(parsed)
}

function normalizeVersionsFile(parsed: unknown): VersionsFile {
  if (Array.isArray(parsed)) {
    // Allow legacy: bare array of entries.
    return {
      $schema: SCHEMA_URL,
      schemaVersion: 2,
      versions: parsed as VersionEntry[],
    }
  }
  if (parsed && typeof parsed === 'object') {
    const obj = parsed as Partial<VersionsFile>
    return {
      $schema: obj.$schema ?? SCHEMA_URL,
      schemaVersion: 2,
      versions: Array.isArray(obj.versions) ? obj.versions : [],
    }
  }
  return emptyVersionsFile()
}

/**
 * Insert a new version at the head of versions.json, rotate any entries past
 * `archiveAfter` into archive.json. Returns the files that need to be written.
 */
export interface RotateResult {
  versions: VersionsFile
  archive: ArchiveFile
  archiveChanged: boolean
}

export function rotate(
  current: VersionsFile,
  archive: ArchiveFile,
  newEntry: VersionEntry,
  archiveAfter: number,
): RotateResult {
  const next: VersionEntry[] = [newEntry, ...current.versions]
  let archiveChanged = false
  let archived = archive.versions
  if (next.length > archiveAfter) {
    const toArchive = next.slice(archiveAfter)
    archived = [...toArchive, ...archive.versions]
    archiveChanged = true
    next.length = archiveAfter
  }
  return {
    versions: { ...current, schemaVersion: 2, versions: next },
    archive: { ...archive, schemaVersion: 2, versions: archived },
    archiveChanged,
  }
}

export async function writeJson(path: string, data: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(data, null, 2) + '\n', 'utf8')
}
