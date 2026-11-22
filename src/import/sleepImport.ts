import { messages } from '../i18n'
import { db } from '../database/db'
import type { SleepSession } from '../database/types'

import { readHealthConnectSleep, toSleepSession } from './healthConnect'
import type { HealthConnectSleepRecord } from './healthConnect'
import { isSqliteFile, openSqlite } from './sqlite'
import { listZipEntries, readZipEntry } from './zip'

/**
 * Import framework for sleep sessions (PROJECT_SPEC.md §10.5).
 *
 * 1. Preview: read and validate the file, compare with what is already in
 *    the app, and report — nothing is written.
 * 2. Import: add the new sessions in ONE transaction. If anything fails,
 *    nothing is added (no partial import).
 *
 * Report categories:
 * - to import:        new, valid sessions;
 * - skipped duplicates: already imported (same source record, unchanged),
 *                     or listed twice in the file;
 * - need attention:   already imported but changed in the source since
 *                     (the app's version is kept), or already imported and
 *                     later deleted (restore it from Deleted data);
 * - invalid:          not imported, with the reason;
 * - failed:           reported if the final write fails (then nothing is
 *                     imported).
 * Imported originals are never overwritten by a later import.
 */

export interface ImportIssue {
  label: string
  reason: string
}

export interface SleepImportPlan {
  fileName: string
  sourceLabel: string
  found: number
  toAdd: SleepSession[]
  duplicates: ImportIssue[]
  needsAttention: ImportIssue[]
  invalid: ImportIssue[]
  notes: string[]
  /** Record types in the file that are not imported (with row counts). */
  otherData: { label: string; count: number }[]
  /** First and last session start in the file (UTC), if any. */
  firstStartUtc: string | null
  lastStartUtc: string | null
}

const HEALTH_CONNECT_DB = 'health_connect_export.db'

function label(record: HealthConnectSleepRecord): string {
  const start = Number.isFinite(record.startMs) ? new Date(record.startMs).toISOString().slice(0, 16).replace('T', ' ') : messages().importText.unknownTime
  return messages().importText.sleepFile.session(start, record.appName || null)
}

function lastModified(session: SleepSession): unknown {
  const healthConnect = session.metadata?.healthConnect as { lastModifiedTime?: unknown } | undefined
  return healthConnect?.lastModifiedTime ?? null
}

/**
 * Compares parsed Health Connect records with the sessions already stored
 * (including deleted ones). Pure: does not touch the database.
 */
export function planSleepImport(
  input: {
    fileName: string
    records: HealthConnectSleepRecord[]
    otherData: { label: string; count: number }[]
  },
  existing: readonly SleepSession[],
  options: { importedAt: string; newId: () => string },
): SleepImportPlan {
  const byKey = new Map(existing.map((session) => [session.dedupeKey, session]))
  const seenInFile = new Set<string>()
  const plan: SleepImportPlan = {
    fileName: input.fileName,
    sourceLabel: 'Health Connect',
    found: input.records.length,
    toAdd: [],
    duplicates: [],
    needsAttention: [],
    invalid: [],
    notes: [],
    otherData: input.otherData,
    firstStartUtc: null,
    lastStartUtc: null,
  }

  for (const record of input.records) {
    let session: SleepSession

    try {
      session = toSleepSession(record, { id: options.newId(), importedAt: options.importedAt })
    } catch (caughtError) {
      plan.invalid.push({ label: label(record), reason: caughtError instanceof Error ? caughtError.message : 'invalid record' })
      continue
    }

    plan.firstStartUtc = plan.firstStartUtc === null || session.startUtc < plan.firstStartUtc ? session.startUtc : plan.firstStartUtc
    plan.lastStartUtc = plan.lastStartUtc === null || session.startUtc > plan.lastStartUtc ? session.startUtc : plan.lastStartUtc

    if (seenInFile.has(session.dedupeKey)) {
      plan.duplicates.push({ label: label(record), reason: 'listed twice in the file' })
      continue
    }

    seenInFile.add(session.dedupeKey)
    const stored = byKey.get(session.dedupeKey)

    if (!stored) {
      plan.toAdd.push(session)
    } else if (stored.deletedAt !== null) {
      plan.needsAttention.push({
        label: label(record),
        reason: 'already imported and later deleted; restore it from Deleted data if you want it back',
      })
    } else if (lastModified(stored) !== lastModified(session)) {
      plan.needsAttention.push({
        label: label(record),
        reason: 'changed in Health Connect since it was imported; the version already in the app was kept',
      })
    } else {
      plan.duplicates.push({ label: label(record), reason: 'already imported' })
    }
  }

  const unknownCodes = plan.toAdd.filter((session) => (session.metadata?.healthConnect as { unknownStageCodes?: unknown })?.unknownStageCodes)
  if (unknownCodes.length > 0) {
    plan.notes.push(`${unknownCodes.length} session(s) contain stage codes this app does not know; those stages are kept as "unknown" (original codes preserved).`)
  }

  const manual = existing.filter((session) => session.source === 'manual' && session.deletedAt === null)
  const overlapping = plan.toAdd.filter((session) =>
    manual.some((other) => other.startUtc < session.endUtc && session.startUtc < other.endUtc),
  ).length

  if (overlapping > 0) {
    plan.notes.push(`${overlapping} imported session(s) overlap sessions you logged by hand. Both are kept; the dashboard merges overlapping sessions so the time is counted once.`)
  }

  // Health Connect can hold two records for the same night (e.g. written by
  // two apps). Both are originals and are kept; the sleep engine merges them.
  const times = new Set(
    existing.filter((session) => session.deletedAt === null).map((session) => `${session.startUtc}|${session.endUtc}`),
  )
  let sameTimes = 0
  for (const session of plan.toAdd) {
    const key = `${session.startUtc}|${session.endUtc}`
    if (times.has(key)) sameTimes += 1
    times.add(key)
  }
  if (sameTimes > 0) {
    plan.notes.push(`${sameTimes} session(s) have exactly the same bedtime and wake time as another session (a second Health Connect record, e.g. from another app). Both are kept; the dashboard counts the time once.`)
  }

  return plan
}

/** Extracts the Health Connect database from a .zip export (or takes a .db as is). */
export async function extractHealthConnectDatabase(bytes: Uint8Array): Promise<Uint8Array> {
  if (isSqliteFile(bytes)) {
    return bytes
  }

  const entries = listZipEntries(bytes)
  const entry =
    entries.find((item) => item.name === HEALTH_CONNECT_DB || item.name.endsWith(`/${HEALTH_CONNECT_DB}`)) ??
    entries.find((item) => item.name.toLowerCase().endsWith('.db'))

  if (!entry) {
    throw new Error(messages().importText.sleepFile.noDatabase)
  }

  return readZipEntry(bytes, entry)
}

/** Reads a Health Connect export file and plans the import. Writes nothing. */
export async function previewHealthConnectImport(bytes: Uint8Array, fileName: string): Promise<SleepImportPlan> {
  const database = await openSqlite(await extractHealthConnectDatabase(bytes))

  try {
    const data = readHealthConnectSleep(database)
    const existing = await db.sleepSessions.toArray()

    return planSleepImport(
      { fileName, records: data.records, otherData: data.otherData },
      existing,
      { importedAt: new Date().toISOString(), newId: () => crypto.randomUUID() },
    )
  } finally {
    database.close()
  }
}

/**
 * Adds the planned sessions in one transaction. If any session now
 * conflicts (e.g. imported meanwhile in another tab) or a write fails,
 * nothing is imported.
 */
export async function applySleepImport(plan: SleepImportPlan): Promise<number> {
  try {
    await db.transaction('rw', db.sleepSessions, async () => {
      await db.sleepSessions.bulkAdd(plan.toAdd)
    })
  } catch (caughtError) {
    console.error('Import failed:', caughtError)
    throw new Error(
      messages().importText.changedSincePreview,
    )
  }

  return plan.toAdd.length
}
