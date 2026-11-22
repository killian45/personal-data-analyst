import { db } from '../database/db'
import type { ExternalSample } from '../database/types'
import { messages } from '../i18n'
import { createAutoImporter } from '../screenTime/autoImport'
import { addDays } from '../stats/subjects'
import { formatInTimezone, getDeviceTimezone } from '../time/time'

import {
  buildDailySamples,
  buildExerciseSamples,
  fromPlugin,
  HEALTH_DAILY_KINDS,
  HEALTH_LABELS,
  HEALTH_MEASUREMENT_TYPES,
  planHealthImport,
} from './healthData'
import type { ExerciseRecord, HealthImportPlan, HealthKind, IntervalRecord, PointRecord, SeriesRecord } from './healthData'

/**
 * Reading Health Connect activity and heart data on the phone and saving
 * it (docs/HEALTH_DATA_PLAN.md). Read only: nothing is written to Health
 * Connect.
 */

/** First import: this many days back (heart-rate history can be large). */
export const FIRST_IMPORT_DAYS = 90
/** Later imports re-read this many days (data often arrives late). */
export const OVERLAP_DAYS = 7

export type ImportKind = HealthKind | 'exercise'

/** Health Connect record type and Android permission for each kind. */
export const HEALTH_SOURCES: Record<ImportKind, { recordType: string; permission: string }> = {
  steps: { recordType: 'Steps', permission: 'android.permission.health.READ_STEPS' },
  distance: { recordType: 'Distance', permission: 'android.permission.health.READ_DISTANCE' },
  restingHeartRate: { recordType: 'RestingHeartRate', permission: 'android.permission.health.READ_RESTING_HEART_RATE' },
  heartRate: { recordType: 'HeartRateSeries', permission: 'android.permission.health.READ_HEART_RATE' },
  exercise: { recordType: 'ExerciseSession', permission: 'android.permission.health.READ_EXERCISE' },
}
export const IMPORT_KINDS: readonly ImportKind[] = [...HEALTH_DAILY_KINDS, 'exercise']

/** Kinds whose read permission was granted. */
export function grantedKinds(grantedPermissions: readonly string[]): ImportKind[] {
  return IMPORT_KINDS.filter((kind) => grantedPermissions.includes(HEALTH_SOURCES[kind].permission))
}

/** First day to read: the last stored day minus the overlap, or FIRST_IMPORT_DAYS back. */
export function readWindowStart(existing: readonly ExternalSample[], today: string): string {
  const days = existing
    .map((sample) => (sample.metadata as { localDate?: unknown } | null)?.localDate)
    .filter((date): date is string => typeof date === 'string')
  if (days.length === 0) return addDays(today, -FIRST_IMPORT_DAYS)
  const latest = days.reduce((max, date) => (date > max ? date : max))
  return addDays(latest < today ? latest : today, -OVERLAP_DAYS)
}

/** Plan + what was read, for the panel. */
export interface HealthPreview extends HealthImportPlan {
  from: string
  to: string
  kinds: ImportKind[]
}

/** Dates the plan adds or changes. */
export function changedHealthDates(plan: HealthImportPlan): string[] {
  return [...plan.toAdd, ...plan.toUpdate].map((sample) => String((sample.metadata as { localDate?: unknown } | null)?.localDate))
}

/** Reads the phone and plans the import. Writes nothing. */
export async function previewHealthImport(now = new Date()): Promise<HealthPreview> {
  const plugin = await import('./healthDataPlugin')
  const kinds = grantedKinds(await plugin.grantedHealthPermissions())
  const zone = getDeviceTimezone()
  const today = formatInTimezone(now.toISOString(), zone, 'yyyy-MM-dd')
  const existing = await db.externalSamples.where('measurementType').anyOf([...HEALTH_MEASUREMENT_TYPES]).toArray()
  const from = readWindowStart(existing, today)
  // A day earlier than the first local day, to cover any UTC offset.
  const startTime = new Date(Date.parse(`${addDays(from, -1)}T00:00:00Z`))
  const options = { zone, today, importedAt: now.toISOString(), newId: () => crypto.randomUUID() }

  const built: ExternalSample[] = []
  const notImported: HealthImportPlan['notImported'] = []
  for (const kind of kinds) {
    const raw = await plugin.readHealthRecords(HEALTH_SOURCES[kind].recordType, startTime, now)
    const records: unknown[] = []
    for (const item of raw) {
      try {
        records.push(fromPlugin(kind, item as Record<string, unknown>))
      } catch (error) {
        notImported.push({ label: messages().labels.healthRecord(HEALTH_LABELS[kind]), reason: error instanceof Error ? error.message : messages().labels.cannotBeRead })
      }
    }
    const result = kind === 'exercise'
      ? buildExerciseSamples(records as ExerciseRecord[], options)
      : buildDailySamples(kind, records as (IntervalRecord | PointRecord | SeriesRecord)[], options)
    // Only days in the window (older days are not re-read, so not compared).
    built.push(...result.samples.filter((sample) => String((sample.metadata as { localDate?: unknown }).localDate) >= from))
    notImported.push(...result.notImported)
  }

  return { ...planHealthImport(built, existing, options.importedAt, notImported), from, to: addDays(today, -1), kinds }
}

/**
 * Saves the plan in one transaction. If a planned day was added or
 * changed meanwhile (another run, sync), nothing is saved.
 */
export async function applyHealthImport(plan: HealthImportPlan): Promise<number> {
  try {
    await db.transaction('rw', db.externalSamples, async () => {
      await db.externalSamples.bulkAdd(plan.toAdd)
      for (const update of plan.toUpdate) {
        const current = await db.externalSamples.get(update.id)
        if (!current || current.revision !== update.revision - 1 || current.deletedAt !== null) {
          throw new Error(`changed meanwhile: ${update.dedupeKey}`)
        }
        await db.externalSamples.put(update)
      }
    })
  } catch (error) {
    console.error('Health Connect import failed:', error)
    throw new Error(messages().importText.changedDuringImport)
  }
  return plan.toAdd.length + plan.toUpdate.length
}

/** Automatic import of these kinds (same rules as screen time; own on/off and last result). */
export const healthImporter = createAutoImporter<HealthPreview>('pda.healthDataAutoImport', changedHealthDates, 'Health Connect')
