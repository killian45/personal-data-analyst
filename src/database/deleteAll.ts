import { LOCATION_TYPES } from '../location/location'
import { messages } from '../i18n'
import { SCREEN_TIME_DAILY } from '../screenTime/screenTime'
import { runWithSyncPaused } from '../sync/engine'

import type { PersonalDataDatabase } from './db'

/**
 * "Delete all data on this device" (post-spec improvement 2, approved
 * 2026-11-12). Deletes EVERY local record — including the sync link —
 * only on this device. Nothing is sent to the server: the cloud copy and
 * other devices are untouched.
 *
 * Safeguards (all must be met; checked again at deletion time):
 * - a backup downloaded first when the data may exist nowhere else: the
 *   device is not linked, or has unsent changes or sync conflicts;
 * - unsent changes (linked device) explicitly accepted as lost;
 * - running stopwatches explicitly accepted as lost;
 * - "DELETE" typed;
 * - nothing changed since the summary was shown (same counts).
 * The deletion empties every table in ONE transaction, while no sync
 * round can run.
 */

export interface LocalDataSummary {
  counts: { label: string; count: number }[]
  total: number
  linked: boolean
  pending: number
  conflicts: number
  runningStopwatches: number
  /** Detects changes between the summary and the deletion. */
  fingerprint: string
}

export interface DeleteChoices {
  backupDownloaded: boolean
  acceptLosingUnsent: boolean
  acceptLosingStopwatches: boolean
  confirmation: string
}

const SYNCED = ['habits', 'entries', 'sleepSessions', 'externalSamples', 'settings', 'contacts', 'contactInteractions'] as const

export async function summarizeLocalData(db: PersonalDataDatabase): Promise<LocalDataSummary> {
  return db.transaction('r', db.tables, async () => {
    const samples = await db.externalSamples.toArray()
    const screenTime = samples.filter((sample) => sample.measurementType === SCREEN_TIME_DAILY).length
    const location = samples.filter((sample) => (LOCATION_TYPES as readonly string[]).includes(sample.measurementType)).length
    const counts = [
      { label: messages().dbText.counts.habits, count: await db.habits.count() },
      { label: messages().dbText.counts.entries, count: await db.entries.count() },
      { label: messages().dbText.counts.sleep, count: await db.sleepSessions.count() },
      { label: messages().dbText.counts.screenTime, count: screenTime },
      { label: messages().dbText.counts.location, count: location },
      { label: messages().dbText.counts.samples, count: samples.length - screenTime - location },
      { label: messages().dbText.counts.settings, count: await db.settings.count() },
      { label: messages().dbText.counts.timers, count: await db.activeTimers.count() },
      { label: messages().dbText.counts.contacts, count: await db.contacts.count() },
      { label: messages().dbText.counts.interactions, count: await db.contactInteractions.count() },
      { label: messages().dbText.counts.conflicts, count: await db.syncConflicts.count() },
    ]
    let pending = 0
    let conflicts = 0
    for (const name of SYNCED) {
      pending += await db.table(name).where('syncStatus').equals('pending').count()
      conflicts += await db.table(name).where('syncStatus').equals('conflict').count()
    }
    const linked = (await db.syncState.count()) > 0
    const tableCounts = await Promise.all(db.tables.map(async (table) => `${table.name}:${await table.count()}`))
    return {
      counts,
      total: counts.reduce((sum, item) => sum + item.count, 0),
      linked,
      pending,
      conflicts,
      runningStopwatches: counts[7].count,
      fingerprint: `${tableCounts.join(',')}|${pending}|${conflicts}|${linked}`,
    }
  })
}

/** Whether a backup is required before deleting (the data may exist nowhere else). */
export function backupRequired(summary: LocalDataSummary): boolean {
  return !summary.linked || summary.pending > 0 || summary.conflicts > 0
}

/** The steps still missing before deletion is allowed (empty = allowed). Pure. */
export function missingSteps(summary: LocalDataSummary, choices: DeleteChoices): string[] {
  const missing: string[] = []
  if (summary.total === 0 && !summary.linked) missing.push(messages().dbText.nothingToDelete)
  if (backupRequired(summary) && !choices.backupDownloaded) missing.push(messages().dbText.backupFirst)
  if (summary.linked && summary.pending > 0 && !choices.acceptLosingUnsent) {
    missing.push(messages().dbText.syncOrConfirm(summary.pending))
  }
  if (summary.runningStopwatches > 0 && !choices.acceptLosingStopwatches) missing.push(messages().dbText.confirmStopwatches)
  // The word of the current language (DELETE, SUPPRIMER…), as the screen asks.
  const word = messages().confirmWords.delete
  if (choices.confirmation.trim() !== word) missing.push(messages().dbText.typeToConfirm(word))
  return missing
}

/**
 * Deletes every record on this device (see the safeguards above). Throws,
 * deleting nothing, if a safeguard is not met or the data changed.
 */
export async function deleteAllLocalData(db: PersonalDataDatabase, summary: LocalDataSummary, choices: DeleteChoices): Promise<void> {
  const missing = missingSteps(summary, choices)
  if (missing.length > 0) throw new Error(missing[0])

  await runWithSyncPaused(db, async () => {
    const current = await summarizeLocalData(db)
    if (current.fingerprint !== summary.fingerprint) {
      throw new Error(messages().dbText.changedSinceReview)
    }
    await db.transaction('rw', db.tables, async () => {
      for (const table of db.tables) await table.clear()
    })
  })
}

/** Set just before the app restarts after a deletion, so the result can be shown. */
const JUST_DELETED_KEY = 'pda.deletedAllData'

export function markJustDeleted(): void {
  try {
    sessionStorage.setItem(JUST_DELETED_KEY, '1')
  } catch {
    // Storage unavailable: the confirmation message is simply not shown.
  }
}

export function wasJustDeleted(): boolean {
  try {
    return sessionStorage.getItem(JUST_DELETED_KEY) === '1'
  } catch {
    return false
  }
}

export function clearJustDeleted(): void {
  try {
    sessionStorage.removeItem(JUST_DELETED_KEY)
  } catch {
    // Nothing to clear.
  }
}
