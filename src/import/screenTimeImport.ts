import { messages } from '../i18n'
import { db } from '../database/db'
import { stableStringify } from '../database/stableStringify'
import { initialSyncFields } from '../database/sync'
import type { ExternalSample } from '../database/types'
import {
  SCREEN_TIME_DAILY,
  SCREEN_TIME_FORMAT,
  buildScreenTimeDedupeKey,
  localDayBoundsUtc,
  nextLocalDate,
  validateScreenTimeSample,
} from '../screenTime/screenTime'
import type { ScreenTimeMetadata } from '../screenTime/screenTime'
import { formatInTimezone, getUtcOffsetMinutes } from '../time/time'

import { APP_USAGE_FILE_FORMAT, APP_USAGE_SOURCE_APP, parseAppUsageHistory } from './appUsage'
import type { ImportIssue } from './sleepImport'

/**
 * Screen-time file import (PROJECT_SPEC.md §10.5, docs/PHASE5_PLAN.md).
 *
 * Same framework as the sleep import: a preview that writes nothing, then
 * one all-or-nothing transaction. Report categories:
 * - to import: new, valid days;
 * - skipped duplicates: the same day with the same figures is already in
 *   the app, or was chosen twice;
 * - need attention: the same day is already in the app with different
 *   figures (the app's version is kept), or was deleted (restore it from
 *   Deleted data);
 * - invalid: unreadable files, unfinished days, impossible values.
 * Stored days are never overwritten by a later import.
 */

export interface ScreenTimeFile {
  fileName: string
  text: string
}

export interface ScreenTimeImportPlan {
  fileCount: number
  /** Days read successfully from the files. */
  found: number
  timezone: string
  toAdd: ExternalSample[]
  duplicates: ImportIssue[]
  needsAttention: ImportIssue[]
  invalid: ImportIssue[]
  notes: string[]
  firstDate: string | null
  lastDate: string | null
}

/** "2026-11-09" → "09/11/2026" (the user's preferred date format). */
export function formatDayMonthYear(localDate: string): string {
  const [year, month, day] = localDate.split('-')
  return `${day}/${month}/${year}`
}

function dayLabel(localDate: string, fileName: string): string {
  return messages().importText.screenTimeFile.day(formatDayMonthYear(localDate), fileName)
}

/**
 * Same total and same per-app times. Apps are compared by package when
 * known (phone data: a renamed or uninstalled app must not count as a
 * change), otherwise by name (App Usage files).
 */
function sameFigures(a: ExternalSample, b: ExternalSample): boolean {
  const apps = (sample: ExternalSample) => {
    const list = (sample.metadata as ScreenTimeMetadata | null)?.apps ?? null
    return list === null
      ? null
      : list.map((app) => [typeof app.package === 'string' ? app.package : app.name, app.seconds, app.opens])
  }
  return a.value === b.value && stableStringify(apps(a)) === stableStringify(apps(b))
}

/**
 * Sorts one new day into the plan (shared by the file and phone imports):
 * new → to add; same day and figures already stored or chosen →
 * duplicate; different figures or deleted → needs attention. Stored days
 * are never replaced.
 */
export function classifyScreenTimeDay(
  sample: ExternalSample,
  label: string,
  state: { stored: ReadonlyMap<string, ExternalSample>; chosen: Map<string, ExternalSample> },
  plan: Pick<ScreenTimeImportPlan, 'toAdd' | 'duplicates' | 'needsAttention'>,
): void {
  const earlier = state.chosen.get(sample.dedupeKey)
  if (earlier) {
    if (sameFigures(earlier, sample)) {
      plan.duplicates.push({ label, reason: 'the same day was chosen twice' })
    } else {
      plan.needsAttention.push({ label, reason: 'another chosen file has different figures for the same day; only the first one is used' })
    }
    return
  }
  state.chosen.set(sample.dedupeKey, sample)

  const previous = state.stored.get(sample.dedupeKey)
  if (!previous) {
    plan.toAdd.push(sample)
  } else if (previous.deletedAt !== null) {
    plan.needsAttention.push({ label, reason: 'already imported and later deleted; restore it from Deleted data if you want it back' })
  } else if (!sameFigures(previous, sample)) {
    plan.needsAttention.push({ label, reason: 'already in the app with different figures; the version already in the app was kept' })
  } else {
    plan.duplicates.push({ label, reason: 'already imported' })
  }
}

/**
 * Reads the files and compares them with the screen time already stored
 * (including deleted days). Pure: does not touch the database.
 */
export function planScreenTimeImport(
  files: readonly ScreenTimeFile[],
  existing: readonly ExternalSample[],
  options: { importedAt: string; newId: () => string; timezone: string; today: string },
): ScreenTimeImportPlan {
  const stored = new Map(existing.map((sample) => [sample.dedupeKey, sample]))
  const chosen = new Map<string, ExternalSample>()
  const plan: ScreenTimeImportPlan = {
    fileCount: files.length,
    found: 0,
    timezone: options.timezone,
    toAdd: [],
    duplicates: [],
    needsAttention: [],
    invalid: [],
    notes: [],
    firstDate: null,
    lastDate: null,
  }
  let roundingDifferences = 0

  for (const file of files) {
    let sample: ExternalSample
    let localDate: string

    try {
      const day = parseAppUsageHistory(file.text)
      localDate = day.localDate

      if (localDate >= options.today) {
        throw new Error('this day has not ended yet; import it tomorrow')
      }
      if (day.createdLocal !== null && day.createdLocal < `${nextLocalDate(localDate)}T00:00`) {
        throw new Error(
          `the file was exported at ${day.createdLocal.slice(11)} on that same day, before the day ended; ` +
            'export it again after midnight',
        )
      }

      const { startUtc, endUtc } = localDayBoundsUtc(localDate, options.timezone)
      const daySeconds = (Date.parse(endUtc) - Date.parse(startUtc)) / 1000
      if (day.totalSeconds > daySeconds) {
        throw new Error('the total usage time is longer than the day itself')
      }

      if (Math.abs(day.appsSeconds - day.totalSeconds) > day.apps.length + 2) {
        roundingDifferences += 1
      }

      const metadata: ScreenTimeMetadata = {
        format: SCREEN_TIME_FORMAT,
        localDate,
        apps: day.apps,
        fileFormat: APP_USAGE_FILE_FORMAT,
        fileName: file.fileName,
        exportCreatedLocal: day.createdLocal,
      }

      sample = {
        id: options.newId(),
        source: 'import',
        externalId: null,
        sourceApp: APP_USAGE_SOURCE_APP,
        dedupeKey: buildScreenTimeDedupeKey('import', localDate),
        measurementType: SCREEN_TIME_DAILY,
        value: day.totalSeconds,
        unit: 's',
        startUtc,
        endUtc,
        timezone: options.timezone,
        startOffsetMinutes: getUtcOffsetMinutes(startUtc, options.timezone),
        importedAt: options.importedAt,
        metadata,
        ...initialSyncFields(),
        createdAt: options.importedAt,
        updatedAt: options.importedAt,
        deletedAt: null,
      }

      // Same rules as restore and sync, so an imported day is always accepted there.
      validateScreenTimeSample(sample)
    } catch (caughtError) {
      const reason = caughtError instanceof Error ? caughtError.message : 'unreadable file'
      plan.invalid.push({ label: file.fileName, reason: reason.charAt(0).toLowerCase() + reason.slice(1).replace(/\.$/, '') })
      continue
    }

    plan.found += 1
    plan.firstDate = plan.firstDate === null || localDate < plan.firstDate ? localDate : plan.firstDate
    plan.lastDate = plan.lastDate === null || localDate > plan.lastDate ? localDate : plan.lastDate
    const label = dayLabel(localDate, file.fileName)

    classifyScreenTimeDay(sample, label, { stored, chosen }, plan)
  }

  if (roundingDifferences > 0) {
    plan.notes.push(
      `${roundingDifferences} day(s): the per-app times do not add up to the day's total. The app's own total is used; the per-app times are kept as they are.`,
    )
  }

  return plan
}

/** Reads the chosen files and plans the import. Writes nothing. */
export async function previewScreenTimeImport(files: readonly ScreenTimeFile[], timezone: string): Promise<ScreenTimeImportPlan> {
  const existing = await db.externalSamples.where('measurementType').equals(SCREEN_TIME_DAILY).toArray()
  const now = new Date().toISOString()

  return planScreenTimeImport(files, existing, {
    importedAt: now,
    newId: () => crypto.randomUUID(),
    timezone,
    today: formatInTimezone(now, timezone, 'yyyy-MM-dd'),
  })
}

/**
 * Adds the planned days in one transaction. If a day was added meanwhile
 * (for example in another tab, or by sync) or a write fails, nothing is
 * imported.
 */
export async function applyScreenTimeImport(plan: Pick<ScreenTimeImportPlan, 'toAdd'>): Promise<number> {
  try {
    await db.transaction('rw', db.externalSamples, async () => {
      await db.externalSamples.bulkAdd(plan.toAdd)
    })
  } catch (caughtError) {
    console.error('Screen-time import failed:', caughtError)
    throw new Error(
      messages().importText.changedSincePreviewFiles,
    )
  }

  return plan.toAdd.length
}

/** Message shown after a successful import. */
export function screenTimeResultText(plan: ScreenTimeImportPlan, imported: number): string {
  return (
    messages().importText.screenTimeImported(imported) +
    (plan.duplicates.length > 0 ? messages().importText.skippedDuplicates(plan.duplicates.length) : '') +
    (plan.needsAttention.length > 0 ? messages().importText.needAttentionAgain(plan.needsAttention.length) : '') +
    (plan.invalid.length > 0 ? messages().importText.filesInvalid(plan.invalid.length) : '')
  )
}
