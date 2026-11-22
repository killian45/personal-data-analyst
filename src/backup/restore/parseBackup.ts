import { messages } from '../../i18n'
import { CURRENT_SCHEMA_VERSION } from '../../database/db'
import { upgradeHabitToV7, upgradeTablesToV4, upgradeTablesToV8, upgradeTablesToV9 } from '../../database/upgrades'
import type { PlainRecord } from '../../database/upgrades'
import { BACKUP_FORMAT, BACKUP_FORMAT_VERSION, computeTablesHash } from '../backup'

/**
 * Reads a backup file and checks that it can be restored safely.
 * Nothing here touches the database.
 *
 * Checks, in order:
 * 1. The text is JSON and describes a Personal Data Analyst backup.
 * 2. The backup format and database version are supported (3 to current).
 *    Backups from a newer app version are refused.
 * 3. The expected tables are present and contain records (objects).
 * 4. The SHA-256 fingerprint matches the tables: a damaged or edited file
 *    is refused.
 * 5. The record counts match the tables.
 * Then older backups are converted to the current version with the same
 * rules as the database upgrades (src/database/upgrades.ts).
 */

/** Oldest database version for which backups exist (backup was added in v3). */
export const OLDEST_SUPPORTED_BACKUP_SCHEMA = 3

export interface CurrentTables {
  habits: PlainRecord[]
  entries: PlainRecord[]
  activeTimers: PlainRecord[]
  settings: PlainRecord[]
  sleepSessions: PlainRecord[]
  externalSamples: PlainRecord[]
  contacts: PlainRecord[]
  contactInteractions: PlainRecord[]
}

export interface ParsedBackup {
  exportedAt: string
  /** Database version that produced the backup (before conversion). */
  schemaVersion: number
  /** Tables converted to the current database version. */
  tables: CurrentTables
}

const BASE_TABLES = ['activeTimers', 'entries', 'externalSamples', 'habits', 'sleepSessions']

function expectedTables(schemaVersion: number): string[] {
  const tables = schemaVersion >= 5 ? [...BASE_TABLES, 'settings'] : [...BASE_TABLES]
  if (schemaVersion >= 9) tables.push('contacts', 'contactInteractions')
  return tables.sort()
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export async function parseBackup(text: string): Promise<ParsedBackup> {
  let raw: unknown

  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error(messages().backupText.notJson)
  }

  if (!isObject(raw) || raw.format !== BACKUP_FORMAT) {
    throw new Error(messages().backupText.notBackup)
  }

  if (raw.formatVersion !== BACKUP_FORMAT_VERSION) {
    throw new Error(
      messages().backupText.formatVersion(String(raw.formatVersion)),
    )
  }

  const schemaVersion = raw.schemaVersion

  if (typeof schemaVersion !== 'number' || !Number.isInteger(schemaVersion)) {
    throw new Error(messages().backupText.noSchema)
  }

  if (schemaVersion > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      messages().backupText.newerApp(schemaVersion),
    )
  }

  if (schemaVersion < OLDEST_SUPPORTED_BACKUP_SCHEMA) {
    throw new Error(messages().backupText.tooOld(schemaVersion))
  }

  if (typeof raw.exportedAt !== 'string' || !Number.isFinite(Date.parse(raw.exportedAt))) {
    throw new Error(messages().backupText.noDate)
  }

  const tables = raw.tables

  if (!isObject(tables)) {
    throw new Error(messages().backupText.noTables)
  }

  const names = Object.keys(tables).sort()
  const expected = expectedTables(schemaVersion)

  if (names.join(',') !== expected.join(',')) {
    throw new Error(
      messages().backupText.tablesUnexpected(schemaVersion, names.join(', ')),
    )
  }

  for (const name of names) {
    const records = tables[name]

    if (!Array.isArray(records) || !records.every(isObject)) {
      throw new Error(`The "${name}" table in the backup is damaged.`)
    }
  }

  const typedTables = tables as Record<string, PlainRecord[]>
  const integrity = raw.integrity

  if (
    !isObject(integrity) ||
    integrity.algorithm !== 'SHA-256' ||
    typeof integrity.tablesHash !== 'string'
  ) {
    throw new Error(messages().backupText.noFingerprint)
  }

  if ((await computeTablesHash(typedTables)) !== integrity.tablesHash) {
    throw new Error(
      messages().backupText.fingerprint,
    )
  }

  const counts = raw.counts

  if (
    !isObject(counts) ||
    names.some((name) => counts[name] !== typedTables[name].length)
  ) {
    throw new Error(messages().backupText.counts)
  }

  let converted = {
    habits: typedTables.habits,
    entries: typedTables.entries,
    activeTimers: typedTables.activeTimers,
  }

  if (schemaVersion < 4) {
    try {
      converted = upgradeTablesToV4(converted)
    } catch (caughtError) {
      const reason = caughtError instanceof Error ? caughtError.message : messages().backupText.unknownError
      throw new Error(messages().backupText.convertFailed(reason))
    }
  }

  if (schemaVersion < 7) {
    converted = { ...converted, habits: converted.habits.map(upgradeHabitToV7) }
  }

  let synced = {
    habits: converted.habits,
    entries: converted.entries,
    sleepSessions: typedTables.sleepSessions,
    externalSamples: typedTables.externalSamples,
    settings: typedTables.settings ?? [],
  }

  if (schemaVersion < 8) {
    synced = upgradeTablesToV8(synced)
  }

  const crm = schemaVersion < 9
    ? upgradeTablesToV9({})
    : { contacts: typedTables.contacts, contactInteractions: typedTables.contactInteractions }

  return {
    exportedAt: raw.exportedAt,
    schemaVersion,
    tables: {
      ...synced,
      activeTimers: converted.activeTimers,
      ...crm,
    },
  }
}
