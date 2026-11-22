import { sleepSessionZone } from '../database/sleepSessions'
import type { Entry, ExternalSample, Habit, SleepSession } from '../database/types'
import { describeLocationType, LOCATION_MOVEMENT, LOCATION_VISIT } from '../location/location'
import { chosenScreenTimeIds } from '../screenTime/dailyScreenTime'
import type { ScreenTimeMetadata } from '../screenTime/screenTime'
import { resolveDisplayZone } from '../settings/displayTimezone'
import type { DisplayTimezone } from '../settings/displayTimezone'
import { formatAxisHours } from '../sleep/engine/localTime'
import type { SleepAnalysis } from '../sleep/engine/processSleep'
import { activeDurationMs } from '../stopwatch/duration'
import type { DateRange } from '../stats/delta'
import { formatInTimezone, offsetToZoneName } from '../time/time'

/**
 * Builds export tables (PROJECT_SPEC.md §10). Pure function: no database,
 * no file format. The serialisers (serialise.ts) turn these tables into
 * CSV, XLSX, JSON or Markdown.
 *
 * Conventions for every format:
 * - Dates "YYYY-MM-DD", times "HH:mm" (24-hour).
 * - Date and time columns are in the timezone named in the "Timezone of
 *   date/time" column, which follows the display timezone setting (as in
 *   the Personal Data Log). The event timezone and the exact UTC instant
 *   are always included, so every time is unambiguous.
 * - Units are in the column headers (e.g. "Duration (min)") or in a Unit
 *   column for number habits.
 * - Recorded data (habit entries, sleep sessions) and calculated data
 *   (nights and naps from the sleep engine) are separate tables; the
 *   calculated table says so in its title.
 * - Deleted records are not exported (they remain in backups).
 * - The date filter uses the same local dates as the date columns
 *   (nights and naps: their night date; screen time: its own day).
 * - Screen time: every source's record is exported (one row per day and
 *   source); "Used on Dashboard" marks the one the Dashboard counts.
 * - Location (visits, movements) contains coordinates: those tables are
 *   only exported when chosen (not selected by default in the panel).
 */

export type ExportCategory =
  | 'entries'
  | 'sleepSessions'
  | 'nights'
  | 'screenTime'
  | 'screenTimeApps'
  | 'locationVisits'
  | 'locationMovements'

/** The kinds of data, in display order (their names on screen: messages().exportPanel.categories). */
export const EXPORT_CATEGORIES: { id: ExportCategory }[] = [
  { id: 'entries' },
  { id: 'sleepSessions' },
  { id: 'nights' },
  { id: 'screenTime' },
  { id: 'screenTimeApps' },
  { id: 'locationVisits' },
  { id: 'locationMovements' },
]

/** Chosen by default in the export panel (location only when asked for). */
export const DEFAULT_EXPORT_CATEGORIES: ExportCategory[] = ['entries', 'sleepSessions', 'nights', 'screenTime', 'screenTimeApps']

export type Cell = string | number | boolean | null

export interface ExportColumn {
  key: string
  header: string
}

export interface ExportTable {
  category: ExportCategory
  title: string
  columns: ExportColumn[]
  rows: Record<string, Cell>[]
}

export interface ExportFilters {
  /** Inclusive local dates; null = everything. */
  range: DateRange | null
  /** Habits whose entries are exported; "all" = every habit. */
  habitIds: readonly string[] | 'all'
  categories: readonly ExportCategory[]
}

export interface ExportSource {
  /** Non-deleted habits, including archived ones. */
  habits: readonly Habit[]
  entries: readonly Entry[]
  sleepSessions: readonly SleepSession[]
  sleep: SleepAnalysis
  /** Non-deleted screen-time days (every source). */
  screenTime: readonly ExternalSample[]
  /** Non-deleted location visits and movements. */
  location: readonly ExternalSample[]
}

export interface ExportData {
  exportedAt: string
  displayTimezone: DisplayTimezone
  filters: ExportFilters
  tables: ExportTable[]
}

export interface ExportOptions {
  displayTimezone: DisplayTimezone
  deviceTimezone: string
  exportedAt: string
}

const TYPE_LABELS: Record<string, string> = {
  number: 'Number',
  checkbox: 'Checkbox',
  stopwatch: 'Stopwatch',
  label: 'Label',
  text: 'Text',
}

const SOURCE_LABELS: Record<string, string> = {
  manual: 'Manual',
  health_connect: 'Health Connect',
  android_usage: 'Phone',
  import: 'Import',
}

const MINUTE_MS = 60_000

/** Minutes, rounded to 2 decimals. */
function minutes(ms: number): number {
  return Math.round((ms / MINUTE_MS) * 100) / 100
}

function inRange(date: string, range: DateRange | null): boolean {
  return range === null || (date >= range.start && date <= range.end)
}

const ENTRY_COLUMNS: ExportColumn[] = [
  { key: 'date', header: 'Date' },
  { key: 'time', header: 'Time' },
  { key: 'timezone', header: 'Timezone of date/time' },
  { key: 'eventTimezone', header: 'Event timezone' },
  { key: 'startUtc', header: 'Start (UTC)' },
  { key: 'endUtc', header: 'End (UTC)' },
  { key: 'habit', header: 'Habit' },
  { key: 'type', header: 'Type' },
  { key: 'value', header: 'Value' },
  { key: 'unit', header: 'Unit' },
  { key: 'durationMinutes', header: 'Duration (min)' },
  { key: 'periods', header: 'Periods' },
  { key: 'source', header: 'Source' },
  { key: 'comment', header: 'Comment' },
  { key: 'id', header: 'Entry ID' },
  { key: 'createdAt', header: 'Created (UTC)' },
  { key: 'updatedAt', header: 'Updated (UTC)' },
]

const SLEEP_COLUMNS: ExportColumn[] = [
  { key: 'bedDate', header: 'Bedtime date' },
  { key: 'bedTime', header: 'Bedtime' },
  { key: 'wakeDate', header: 'Wake date' },
  { key: 'wakeTime', header: 'Wake time' },
  { key: 'timezone', header: 'Timezone of date/time' },
  { key: 'eventTimezone', header: 'Event timezone or UTC offset' },
  { key: 'startUtc', header: 'Start (UTC)' },
  { key: 'endUtc', header: 'End (UTC)' },
  { key: 'timeInBedMinutes', header: 'Time in bed (min)' },
  { key: 'reportedSleepMinutes', header: 'Reported sleep (min)' },
  { key: 'stages', header: 'Sleep stages (count)' },
  { key: 'source', header: 'Source' },
  { key: 'sourceApp', header: 'Source app' },
  { key: 'externalId', header: 'External ID' },
  { key: 'comment', header: 'Comment' },
  { key: 'id', header: 'Session ID' },
  { key: 'importedAt', header: 'Imported (UTC)' },
]

const NIGHT_COLUMNS: ExportColumn[] = [
  { key: 'kind', header: 'Kind' },
  { key: 'nightDate', header: 'Night date' },
  { key: 'bedtime', header: 'Bedtime (local)' },
  { key: 'wakeTime', header: 'Wake time (local)' },
  { key: 'bedtimeHours', header: 'Bedtime (hours after 00:00 of night date)' },
  { key: 'wakeHours', header: 'Wake time (hours after 00:00 of night date)' },
  { key: 'sleepMinutes', header: 'Sleep duration (min)' },
  { key: 'timeInBedMinutes', header: 'Time in bed (min)' },
  { key: 'method', header: 'Sleep duration from' },
  { key: 'sessionIds', header: 'Sleep session IDs' },
  { key: 'notes', header: 'Notes' },
]

const SCREEN_TIME_COLUMNS: ExportColumn[] = [
  { key: 'date', header: 'Date' },
  { key: 'minutes', header: 'Screen time (min)' },
  { key: 'apps', header: 'Apps (count)' },
  { key: 'source', header: 'Source' },
  { key: 'sourceApp', header: 'Source app' },
  { key: 'usedOnDashboard', header: 'Used on Dashboard' },
  { key: 'timezone', header: 'Timezone of the day' },
  { key: 'startUtc', header: 'Day start (UTC)' },
  { key: 'endUtc', header: 'Day end (UTC)' },
  { key: 'importedAt', header: 'Imported (UTC)' },
  { key: 'id', header: 'Record ID' },
]

const SCREEN_TIME_APP_COLUMNS: ExportColumn[] = [
  { key: 'date', header: 'Date' },
  { key: 'source', header: 'Source' },
  { key: 'app', header: 'App' },
  { key: 'package', header: 'Package' },
  { key: 'minutes', header: 'Time (min)' },
  { key: 'opens', header: 'Opens' },
  { key: 'id', header: 'Record ID' },
]

const LOCATION_TIME_COLUMNS: ExportColumn[] = [
  { key: 'startDate', header: 'Start date' },
  { key: 'startTime', header: 'Start time' },
  { key: 'endDate', header: 'End date' },
  { key: 'endTime', header: 'End time' },
  { key: 'timezone', header: 'Timezone of date/time' },
  { key: 'offset', header: 'UTC offset at the start' },
  { key: 'startUtc', header: 'Start (UTC)' },
  { key: 'endUtc', header: 'End (UTC)' },
  { key: 'durationMinutes', header: 'Duration (min)' },
]

const VISIT_COLUMNS: ExportColumn[] = [
  ...LOCATION_TIME_COLUMNS,
  { key: 'placeType', header: 'Place type' },
  { key: 'placeTypeCode', header: 'Place type (code)' },
  { key: 'placeId', header: 'Place ID' },
  { key: 'lat', header: 'Latitude' },
  { key: 'lng', header: 'Longitude' },
  { key: 'probability', header: 'Visit probability' },
  { key: 'placeProbability', header: 'Place probability' },
  { key: 'hierarchyLevel', header: 'Place level' },
  { key: 'source', header: 'Source' },
  { key: 'id', header: 'Record ID' },
]

const MOVEMENT_COLUMNS: ExportColumn[] = [
  ...LOCATION_TIME_COLUMNS,
  { key: 'activity', header: 'Activity' },
  { key: 'activityCode', header: 'Activity (code)' },
  { key: 'distanceKm', header: 'Distance (km)' },
  { key: 'startLat', header: 'Start latitude' },
  { key: 'startLng', header: 'Start longitude' },
  { key: 'endLat', header: 'End latitude' },
  { key: 'endLng', header: 'End longitude' },
  { key: 'probability', header: 'Movement probability' },
  { key: 'typeProbability', header: 'Activity probability' },
  { key: 'source', header: 'Source' },
  { key: 'id', header: 'Record ID' },
]

const METHOD_LABELS: Record<string, string> = {
  stages: 'sleep stages',
  reported: 'reported total',
  elapsed: 'time in bed',
}

function entryRows(source: ExportSource, filters: ExportFilters, options: ExportOptions): Record<string, Cell>[] {
  const habits = new Map(source.habits.map((habit) => [habit.id, habit]))
  const wanted = filters.habitIds === 'all' ? null : new Set(filters.habitIds)

  return source.entries
    .filter((entry) => entry.deletedAt === null && habits.has(entry.habitId))
    .filter((entry) => wanted === null || wanted.has(entry.habitId))
    .map((entry) => {
      const habit = habits.get(entry.habitId) as Habit
      const zone = resolveDisplayZone(options.displayTimezone, entry.timezone, options.deviceTimezone)

      return {
        entry,
        habit,
        zone,
        date: formatInTimezone(entry.occurredStart, zone, 'yyyy-MM-dd'),
      }
    })
    .filter(({ date }) => inRange(date, filters.range))
    .sort((a, b) => a.entry.occurredStart.localeCompare(b.entry.occurredStart) || a.entry.id.localeCompare(b.entry.id))
    .map(({ entry, habit, zone, date }) => {
      const stopwatch = entry.habitType === 'stopwatch'

      return {
        date,
        time: formatInTimezone(entry.occurredStart, zone, 'HH:mm'),
        timezone: zone,
        eventTimezone: entry.timezone,
        startUtc: entry.occurredStart,
        endUtc: entry.occurredEnd,
        habit: habit.name,
        type: TYPE_LABELS[entry.habitType],
        value: stopwatch ? null : (entry.value as Cell),
        unit: habit.type === 'number' ? habit.unit : null,
        durationMinutes: stopwatch ? minutes(activeDurationMs(entry.value.segments)) : null,
        periods: stopwatch ? entry.value.segments.length : null,
        source: SOURCE_LABELS[entry.source],
        comment: entry.comment,
        id: entry.id,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
      }
    })
}

function sleepRows(source: ExportSource, filters: ExportFilters, options: ExportOptions): Record<string, Cell>[] {
  return source.sleepSessions
    .filter((session) => session.deletedAt === null)
    .map((session) => {
      const eventZone = sleepSessionZone(session)
      const zone = resolveDisplayZone(options.displayTimezone, eventZone, options.deviceTimezone)
      return { session, eventZone, zone, bedDate: formatInTimezone(session.startUtc, zone, 'yyyy-MM-dd') }
    })
    .filter(({ bedDate }) => inRange(bedDate, filters.range))
    .sort((a, b) => a.session.startUtc.localeCompare(b.session.startUtc) || a.session.id.localeCompare(b.session.id))
    .map(({ session, eventZone, zone, bedDate }) => ({
      bedDate,
      bedTime: formatInTimezone(session.startUtc, zone, 'HH:mm'),
      wakeDate: formatInTimezone(session.endUtc, zone, 'yyyy-MM-dd'),
      wakeTime: formatInTimezone(session.endUtc, zone, 'HH:mm'),
      timezone: zone,
      eventTimezone: eventZone,
      startUtc: session.startUtc,
      endUtc: session.endUtc,
      timeInBedMinutes: minutes(Date.parse(session.endUtc) - Date.parse(session.startUtc)),
      reportedSleepMinutes: session.reportedSleepMs === null ? null : minutes(session.reportedSleepMs),
      stages: session.stages.length,
      source: SOURCE_LABELS[session.source],
      sourceApp: session.sourceApp,
      externalId: session.externalId,
      comment: session.comment,
      id: session.id,
      importedAt: session.importedAt,
    }))
}

function nightRows(source: ExportSource, filters: ExportFilters): Record<string, Cell>[] {
  const nights = source.sleep.nights
    .filter((night) => inRange(night.nightDate, filters.range))
    .map((night) => ({
      sortKey: night.bedtimeUtc,
      row: {
        kind: 'Night',
        nightDate: night.nightDate,
        bedtime: formatAxisHours(night.bedtimeHours),
        wakeTime: formatAxisHours(night.wakeHours),
        bedtimeHours: Math.round(night.bedtimeHours * 10_000) / 10_000,
        wakeHours: Math.round(night.wakeHours * 10_000) / 10_000,
        sleepMinutes: minutes(night.sleepMs),
        timeInBedMinutes: minutes(night.timeInBedMs),
        method: [...new Set(night.methods)].map((method) => METHOD_LABELS[method]).join(', '),
        sessionIds: night.sessionIds.join(' '),
        notes: night.warnings.join(' ') || null,
      } as Record<string, Cell>,
    }))

  const naps = source.sleep.naps
    .filter((nap) => inRange(nap.nightDate, filters.range))
    .map((nap) => ({
      sortKey: nap.startUtc,
      row: {
        kind: 'Nap',
        nightDate: nap.nightDate,
        bedtime: formatInTimezone(nap.startUtc, nap.startZone, 'HH:mm'),
        wakeTime: formatInTimezone(nap.endUtc, nap.endZone, 'HH:mm'),
        bedtimeHours: null,
        wakeHours: null,
        sleepMinutes: minutes(nap.sleepMs),
        timeInBedMinutes: minutes(nap.timeInBedMs),
        method: METHOD_LABELS[nap.method],
        sessionIds: nap.sessionIds.join(' '),
        notes: nap.warnings.join(' ') || null,
      } as Record<string, Cell>,
    }))

  return [...nights, ...naps].sort((a, b) => a.sortKey.localeCompare(b.sortKey)).map((item) => item.row)
}

/** Screen-time records in the range, by day then source, with the Dashboard's choice. */
function screenTimeRecords(source: ExportSource, filters: ExportFilters) {
  const records = source.screenTime
    .filter((sample) => sample.deletedAt === null)
    .map((sample) => ({ sample, date: String(sample.metadata?.localDate ?? ''), meta: sample.metadata as ScreenTimeMetadata | null }))
    .filter(({ date }) => inRange(date, filters.range))
    .sort((a, b) => a.date.localeCompare(b.date) || a.sample.source.localeCompare(b.sample.source) || a.sample.id.localeCompare(b.sample.id))

  // The record the Dashboard uses for each day (shared rule).
  const used = new Set(chosenScreenTimeIds(records.map((record) => record.sample)))
  return { records, used }
}

function screenTimeRows(source: ExportSource, filters: ExportFilters): Record<string, Cell>[] {
  const { records, used } = screenTimeRecords(source, filters)
  return records.map(({ sample, date, meta }) => ({
    date,
    minutes: minutes(sample.value * 1000),
    apps: Array.isArray(meta?.apps) ? meta.apps.length : null,
    source: SOURCE_LABELS[sample.source],
    sourceApp: sample.sourceApp,
    usedOnDashboard: used.has(sample.id) ? 'yes' : 'no',
    timezone: sample.timezone,
    startUtc: sample.startUtc,
    endUtc: sample.endUtc,
    importedAt: sample.importedAt,
    id: sample.id,
  }))
}

function screenTimeAppRows(source: ExportSource, filters: ExportFilters): Record<string, Cell>[] {
  const { records } = screenTimeRecords(source, filters)
  return records.flatMap(({ sample, date, meta }) =>
    (Array.isArray(meta?.apps) ? meta.apps : []).map((app) => ({
      date,
      source: SOURCE_LABELS[sample.source],
      app: app.name,
      package: typeof app.package === 'string' ? app.package : null,
      minutes: minutes(app.seconds * 1000),
      opens: app.opens,
      id: sample.id,
    })),
  )
}

function locationRows(
  source: ExportSource,
  filters: ExportFilters,
  options: ExportOptions,
  measurementType: string,
): Record<string, Cell>[] {
  return source.location
    .filter((sample) => sample.deletedAt === null && sample.measurementType === measurementType)
    .map((sample) => {
      const eventZone = offsetToZoneName(sample.startOffsetMinutes ?? 0)
      const zone = resolveDisplayZone(options.displayTimezone, eventZone, options.deviceTimezone)
      return { sample, zone, startDate: formatInTimezone(sample.startUtc, zone, 'yyyy-MM-dd') }
    })
    .filter(({ startDate }) => inRange(startDate, filters.range))
    .sort((a, b) => a.sample.startUtc.localeCompare(b.sample.startUtc) || a.sample.id.localeCompare(b.sample.id))
    .map(({ sample, zone, startDate }) => {
      const end = sample.endUtc ?? sample.startUtc
      const meta = sample.metadata ?? {}
      const common: Record<string, Cell> = {
        startDate,
        startTime: formatInTimezone(sample.startUtc, zone, 'HH:mm'),
        endDate: formatInTimezone(end, zone, 'yyyy-MM-dd'),
        endTime: formatInTimezone(end, zone, 'HH:mm'),
        timezone: zone,
        offset: offsetToZoneName(sample.startOffsetMinutes ?? 0),
        startUtc: sample.startUtc,
        endUtc: sample.endUtc,
        durationMinutes: minutes(Date.parse(end) - Date.parse(sample.startUtc)),
        probability: (meta.probability as number | null) ?? null,
        source: `${SOURCE_LABELS[sample.source]}${sample.sourceApp ? ` (${sample.sourceApp})` : ''}`,
        id: sample.id,
      }
      if (measurementType === LOCATION_VISIT) {
        return {
          ...common,
          placeType: describeLocationType(String(meta.semanticType)),
          placeTypeCode: meta.semanticType as Cell,
          placeId: (meta.placeId as string | null) ?? null,
          lat: meta.lat as Cell,
          lng: meta.lng as Cell,
          placeProbability: (meta.placeProbability as number | null) ?? null,
          hierarchyLevel: (meta.hierarchyLevel as number | null) ?? null,
        }
      }
      return {
        ...common,
        activity: describeLocationType(String(meta.activityType)),
        activityCode: meta.activityType as Cell,
        distanceKm: Math.round(sample.value) / 1000,
        startLat: meta.startLat as Cell,
        startLng: meta.startLng as Cell,
        endLat: meta.endLat as Cell,
        endLng: meta.endLng as Cell,
        typeProbability: (meta.typeProbability as number | null) ?? null,
      }
    })
}

export function buildExport(source: ExportSource, filters: ExportFilters, options: ExportOptions): ExportData {
  const tables: ExportTable[] = []

  for (const category of EXPORT_CATEGORIES.map((item) => item.id)) {
    if (!filters.categories.includes(category)) {
      continue
    }

    if (category === 'entries') {
      tables.push({ category, title: 'Habit entries', columns: ENTRY_COLUMNS, rows: entryRows(source, filters, options) })
    } else if (category === 'sleepSessions') {
      tables.push({ category, title: 'Sleep sessions (recorded)', columns: SLEEP_COLUMNS, rows: sleepRows(source, filters, options) })
    } else if (category === 'screenTime') {
      tables.push({ category, title: 'Screen time per day (recorded, one row per day and source)', columns: SCREEN_TIME_COLUMNS, rows: screenTimeRows(source, filters) })
    } else if (category === 'locationVisits') {
      tables.push({ category, title: 'Location visits (imported)', columns: VISIT_COLUMNS, rows: locationRows(source, filters, options, LOCATION_VISIT) })
    } else if (category === 'locationMovements') {
      tables.push({ category, title: 'Location movements (imported)', columns: MOVEMENT_COLUMNS, rows: locationRows(source, filters, options, LOCATION_MOVEMENT) })
    } else if (category === 'screenTimeApps') {
      tables.push({ category, title: 'Screen time per app (recorded)', columns: SCREEN_TIME_APP_COLUMNS, rows: screenTimeAppRows(source, filters) })
    } else {
      tables.push({ category, title: 'Nights and naps (calculated by the app)', columns: NIGHT_COLUMNS, rows: nightRows(source, filters) })
    }
  }

  return { exportedAt: options.exportedAt, displayTimezone: options.displayTimezone, filters, tables }
}
