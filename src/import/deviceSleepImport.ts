import { messages } from '../i18n'
/**
 * Health Connect import on the phone (Phase 4 step 4, docs/ANDROID_PLAN.md).
 *
 * Reads ALL sleep sessions this app may read from Health Connect and plans
 * the import with the same framework as the export-file import
 * (planSleepImport): new sessions are imported, known ones skipped as
 * duplicates by Health Connect record id, changed ones flagged. Sessions
 * already in the app that are no longer in Health Connect are flagged too
 * (never deleted). Reading everything each time keeps it simple and
 * robust (no stored change tokens); only new nights are added.
 */

import { db } from '../database/db'
import type { SleepSession } from '../database/types'
import type { HealthConnectSleepRecord } from './healthConnect'
import { fromPluginSleepRecord, type PluginSleepRecord } from './healthConnectDevice'
import type { ImportIssue, SleepImportPlan } from './sleepImport'
import { planSleepImport } from './sleepImport'

export const DEVICE_SOURCE_NAME = 'Health Connect on this phone'
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

function rawLabel(raw: PluginSleepRecord): string {
  const start = typeof raw.startTime === 'string' ? raw.startTime.slice(0, 16).replace('T', ' ') : messages().importText.unknownTime
  return messages().importText.deviceSleep.session(start)
}

function sessionLabel(session: SleepSession): string {
  return messages().importText.deviceSleep.session(session.startUtc.slice(0, 16).replace('T', ' '))
}

/**
 * Plans a phone import. Pure: no database, no plugin.
 * historyGranted: whether data older than 30 days could be read; if not,
 * only sessions from the last 30 days are checked for "no longer in Health
 * Connect" (older ones simply were not readable).
 */
export function planDeviceSleepImport(
  rawRecords: readonly PluginSleepRecord[],
  existing: readonly SleepSession[],
  options: { importedAt: string; newId: () => string; historyGranted: boolean; now: Date },
): SleepImportPlan {
  const records: HealthConnectSleepRecord[] = []
  const unreadable: ImportIssue[] = []
  for (const raw of rawRecords) {
    try {
      records.push(fromPluginSleepRecord(raw))
    } catch (error) {
      unreadable.push({ label: rawLabel(raw), reason: error instanceof Error ? error.message : 'invalid record' })
    }
  }

  const plan = planSleepImport({ fileName: DEVICE_SOURCE_NAME, records, otherData: [] }, existing, options)
  plan.found = rawRecords.length
  plan.invalid.unshift(...unreadable)

  const readIds = new Set(records.map((record) => record.uuid))
  const windowStart = options.historyGranted ? null : new Date(options.now.getTime() - THIRTY_DAYS_MS).toISOString()
  for (const session of existing) {
    if (
      session.source === 'health_connect' &&
      session.deletedAt === null &&
      session.externalId !== null &&
      !readIds.has(session.externalId) &&
      (windowStart === null || session.startUtc >= windowStart)
    ) {
      plan.needsAttention.push({
        label: sessionLabel(session),
        reason: 'no longer in Health Connect (deleted there, or no longer shared with this app); the copy in this app was kept',
      })
    }
  }

  return plan
}

/** Asks for permission if needed, reads Health Connect and plans. Writes nothing. */
export async function previewDeviceSleepImport(): Promise<SleepImportPlan> {
  const plugin = await import('./healthConnectPlugin')

  const status = await plugin.healthConnectStatus()
  if (status !== 'available') {
    throw new Error(
      status === 'not-installed'
        ? messages().importText.deviceSleep.notInstalled
        : messages().importText.deviceSleep.notSupported,
    )
  }

  let permission = await plugin.checkSleepPermission()
  if (!permission.sleep) permission = await plugin.requestSleepPermission()
  if (!permission.sleep) {
    throw new Error(messages().importText.deviceSleep.noPermission)
  }

  const now = new Date()
  const records = await plugin.readAllSleepSessions(now)
  return planDeviceSleepImport(records, await db.sleepSessions.toArray(), {
    importedAt: now.toISOString(),
    newId: () => crypto.randomUUID(),
    historyGranted: permission.history === true,
    now,
  })
}
