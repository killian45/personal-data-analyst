import { db, DEVICE_ONLY_TABLES } from '../database/db'

/**
 * JSON backup export.
 *
 * Backup file format (formatVersion 1):
 *
 * {
 *   "format": "personal-data-analyst-backup",
 *   "formatVersion": 1,          // version of this file layout
 *   "schemaVersion": 3,          // Dexie database version that produced it
 *   "exportedAt": "<UTC ISO>",   // when the backup was created
 *   "counts": { "<table>": n },  // number of records per table
 *   "integrity": {
 *     "algorithm": "SHA-256",
 *     "tablesHash": "<hex>"      // hash of JSON.stringify(tables)
 *   },
 *   "tables": { "<table>": [ ...records exactly as stored... ] }
 * }
 *
 * Rules:
 * - Every database table is included automatically, so new tables
 *   are never forgotten, except the device-only sync tables
 *   (DEVICE_ONLY_TABLES: sync account link, encryption key, pending
 *   sync conflicts), which belong to one device and cannot be restored
 *   elsewhere.
 * - All records are included unchanged, including soft-deleted ones,
 *   so identifiers and timestamps are preserved.
 * - All tables are read in one read-only transaction, so the backup is
 *   a consistent snapshot.
 * - The integrity hash lets a future restore detect damaged or
 *   modified files.
 */

export const BACKUP_FORMAT = 'personal-data-analyst-backup'
export const BACKUP_FORMAT_VERSION = 1

export interface BackupFile {
  format: typeof BACKUP_FORMAT
  formatVersion: number
  schemaVersion: number
  exportedAt: string
  counts: Record<string, number>
  integrity: {
    algorithm: 'SHA-256'
    tablesHash: string
  }
  tables: Record<string, unknown[]>
}

/**
 * Computes a SHA-256 hash (hexadecimal) of the backup tables.
 */
export async function computeTablesHash(
  tables: Record<string, unknown[]>,
): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(tables))
  const digest = await crypto.subtle.digest('SHA-256', bytes)

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Reads the complete local database into a backup object.
 */
export async function createBackup(
  exportedAt: Date = new Date(),
): Promise<BackupFile> {
  if (!db.isOpen()) {
    await db.open()
  }

  const tableNames = db.tables
    .map((table) => table.name)
    .filter((name) => !DEVICE_ONLY_TABLES.includes(name))
    .sort()

  const tables: Record<string, unknown[]> = {}

  await db.transaction('r', tableNames, async () => {
    for (const name of tableNames) {
      tables[name] = await db.table(name).toArray()
    }
  })

  const counts = Object.fromEntries(
    tableNames.map((name) => [name, tables[name].length]),
  )

  return {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    schemaVersion: db.verno,
    exportedAt: exportedAt.toISOString(),
    counts,
    integrity: {
      algorithm: 'SHA-256',
      tablesHash: await computeTablesHash(tables),
    },
    tables,
  }
}

/**
 * Converts a backup to human-readable JSON text.
 */
export function serializeBackup(backup: BackupFile): string {
  return JSON.stringify(backup, null, 2)
}

/**
 * Builds an unambiguous file name using UTC time,
 * e.g. pda-backup-2026-11-09T15-30-00Z.json
 */
export function backupFileName(exportedAt: Date): string {
  const timestamp = exportedAt
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z')
    .replaceAll(':', '-')

  return `pda-backup-${timestamp}.json`
}
