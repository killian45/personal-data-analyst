import { messages } from '../i18n'
import { db } from '../database/db'
import { initialSyncFields } from '../database/sync'
import type { ExternalSample } from '../database/types'
import {
  SCREEN_TIME_DAILY,
  SCREEN_TIME_FORMAT,
  buildScreenTimeDedupeKey,
  validateScreenTimeSample,
} from '../screenTime/screenTime'
import type { ScreenTimeMetadata } from '../screenTime/screenTime'
import { dailyForeground, foregroundIntervals, mergeRanges, mergeUsageEvents } from '../screenTime/usageEvents'
import type { CoveredRange, UsageEventsData } from '../screenTime/usageEvents'
import { addDays } from '../stats/subjects'
import { formatInTimezone, getDeviceTimezone, getUtcOffsetMinutes } from '../time/time'

import { classifyScreenTimeDay, formatDayMonthYear } from './screenTimeImport'
import type { ImportIssue } from './sleepImport'

/**
 * Screen-time import on the phone (Phase 5 step 3, docs/PHASE5_PLAN.md).
 *
 * Method B, chosen after the step 2 test: daily totals calculated from
 * Android's usage events (src/screenTime/usageEvents.ts), without the home
 * screen app(s) — within ±3% of App Usage on 6 of 8 test days.
 *
 * Data: Android's live usage history (~10 days) combined with this app's
 * own saved copy (hourly background capture, UsageCapture.java), so apps
 * uninstalled since — whose history Android deletes — keep their time
 * and name.
 *
 * Rules:
 * - Only finished days fully covered by that data are imported (the first
 *   day is usually incomplete; gaps in the saved copy too: skipped, listed).
 * - Days are read in this phone's current timezone.
 * - A day with no recorded use is not stored (missing is never 0).
 * - Same duplicate rules as the file import: days already stored are
 *   never replaced; different figures are listed for attention.
 * Without the background capture, Android's ~10 days are all there is.
 */

export const PHONE_SOURCE_APP = 'Android (Usage access)'
export const PHONE_METHOD = 'android_events_without_home_v1'
/** The saved copy keeps 60 days (UsageCapture.java). */
const SAVED_HISTORY_DAYS = 60

export interface DeviceScreenTimePlan {
  timezone: string
  /** Complete days read from the phone. */
  found: number
  firstDate: string | null
  lastDate: string | null
  toAdd: ExternalSample[]
  duplicates: ImportIssue[]
  needsAttention: ImportIssue[]
  /** Days not imported because they are incomplete or empty. */
  skipped: ImportIssue[]
  invalid: ImportIssue[]
  notes: string[]
}

export interface PhoneUsageData {
  events: UsageEventsData
  /** Spans for which the events are complete (live history and saved copy). */
  covered: readonly CoveredRange[]
  nowMs: number
  homePackages: readonly string[]
  /** App names by package (missing: the package name is used). */
  labels: Readonly<Record<string, string>>
}

/** Plans a phone import. Pure: no database, no plugin. */
export function planDeviceScreenTimeImport(
  phone: PhoneUsageData,
  existing: readonly ExternalSample[],
  options: { importedAt: string; newId: () => string; timezone: string },
): DeviceScreenTimePlan {
  const plan: DeviceScreenTimePlan = {
    timezone: options.timezone,
    found: 0,
    firstDate: null,
    lastDate: null,
    toAdd: [],
    duplicates: [],
    needsAttention: [],
    skipped: [],
    invalid: [],
    notes: [],
  }

  const covered = mergeRanges(phone.covered)
  if (covered.length === 0) {
    plan.notes.push(messages().importText.deviceScreenTime.noHistory)
    return plan
  }

  const zone = options.timezone
  const first = formatInTimezone(new Date(covered[0].startMs).toISOString(), zone, 'yyyy-MM-dd')
  const yesterday = addDays(formatInTimezone(new Date(phone.nowMs).toISOString(), zone, 'yyyy-MM-dd'), -1)
  const localDates: string[] = []
  for (let date = first; date <= yesterday; date = addDays(date, 1)) localDates.push(date)

  const { intervals, malformedEvents, droppedAtRestart } = foregroundIntervals(phone.events, phone.nowMs)
  const days = dailyForeground(intervals, {
    localDates,
    timezone: zone,
    covered,
    nowMs: phone.nowMs,
    excludePackages: new Set(phone.homePackages),
  })

  const stored = new Map(existing.map((sample) => [sample.dedupeKey, sample]))
  const chosen = new Map<string, ExternalSample>()

  for (const day of days) {
    const label = messages().importText.deviceScreenTime.day(formatDayMonthYear(day.localDate))

    if (day.coverage === 'partial') {
      plan.skipped.push({ label, reason: 'only part of this day is available (in Android or in the saved history), so its total would be too low' })
      continue
    }
    if (day.coverage !== 'full' || day.seconds === null) continue
    if (day.seconds === 0) {
      plan.skipped.push({ label, reason: 'no phone use was recorded (not stored: a missing day is never counted as 0)' })
      continue
    }

    const metadata: ScreenTimeMetadata = {
      format: SCREEN_TIME_FORMAT,
      localDate: day.localDate,
      apps: day.apps
        .filter((app) => app.seconds > 0)
        .map((app) => ({ name: phone.labels[app.pkg] || app.pkg, package: app.pkg, seconds: app.seconds, opens: null })),
      method: PHONE_METHOD,
    }

    const sample: ExternalSample = {
      id: options.newId(),
      source: 'android_usage',
      externalId: null,
      sourceApp: PHONE_SOURCE_APP,
      dedupeKey: buildScreenTimeDedupeKey('android_usage', day.localDate),
      measurementType: SCREEN_TIME_DAILY,
      value: day.seconds,
      unit: 's',
      startUtc: day.startUtc,
      endUtc: day.endUtc,
      timezone: zone,
      startOffsetMinutes: getUtcOffsetMinutes(day.startUtc, zone),
      importedAt: options.importedAt,
      metadata,
      ...initialSyncFields(),
      createdAt: options.importedAt,
      updatedAt: options.importedAt,
      deletedAt: null,
    }

    try {
      validateScreenTimeSample(sample)
    } catch (error) {
      plan.invalid.push({ label, reason: error instanceof Error ? error.message : 'invalid day' })
      continue
    }

    plan.found += 1
    plan.firstDate ??= day.localDate
    plan.lastDate = day.localDate
    classifyScreenTimeDay(sample, label, { stored, chosen }, plan)
  }

  if (droppedAtRestart > 0) {
    plan.notes.push(`${droppedAtRestart} on-screen period(s) ended with a phone restart without a proper shutdown; their end is unknown, so they were not counted.`)
  }
  if (malformedEvents > 0) {
    plan.notes.push(`${malformedEvents} usage event(s) from Android could not be read and were not used.`)
  }

  return plan
}

/** Reads the phone's usage history and plans the import. Writes nothing. */
export async function previewDeviceScreenTimeImport(): Promise<DeviceScreenTimePlan> {
  const plugin = await import('../screenTime/usageStatsPlugin')

  if (!(await plugin.hasUsageAccess())) {
    throw new Error(messages().importText.deviceScreenTime.noAccess)
  }

  // Save the latest events first, then combine the saved copy with what
  // Android still has.
  await plugin.captureUsageNow()
  const depth = await plugin.readHistoryDepth()
  const live = depth.earliestEventMs === null
    ? { packages: [], events: [] }
    : await plugin.readUsageEvents(depth.earliestEventMs, depth.nowMs)
  const saved = await plugin.readCapturedHistory(depth.nowMs - SAVED_HISTORY_DAYS * 86_400_000)
  const events = mergeUsageEvents(live, saved.events)
  const covered = [
    ...saved.covered,
    ...(depth.earliestEventMs === null ? [] : [{ startMs: depth.earliestEventMs, endMs: depth.nowMs }]),
  ]

  const [homePackages, liveLabels, existing] = await Promise.all([
    plugin.readHomePackages(),
    events.packages.length > 0 ? plugin.readAppLabels(events.packages) : Promise.resolve({}),
    db.externalSamples.where('measurementType').equals(SCREEN_TIME_DAILY).toArray(),
  ])
  // Names saved earlier cover apps uninstalled since; current names win.
  const labels = { ...saved.labels, ...liveLabels }

  return planDeviceScreenTimeImport(
    { events, covered, nowMs: depth.nowMs, homePackages, labels },
    existing,
    { importedAt: new Date().toISOString(), newId: () => crypto.randomUUID(), timezone: getDeviceTimezone() },
  )
}

/** Message shown after a successful phone import. */
export function deviceScreenTimeResultText(plan: DeviceScreenTimePlan, imported: number): string {
  return (
    messages().importText.screenTimeImported(imported) +
    (plan.duplicates.length > 0 ? messages().importText.alreadyImported(plan.duplicates.length) : '') +
    (plan.needsAttention.length > 0 ? messages().importText.needAttention(plan.needsAttention.length) : '') +
    (plan.skipped.length > 0 ? messages().importText.incompleteDays(plan.skipped.length) : '')
  )
}
