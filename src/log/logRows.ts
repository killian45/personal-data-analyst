import { sleepSessionZone } from '../database/sleepSessions'
import type {
  DataSource,
  Entry,
  ExternalSample,
  Habit,
  HabitType,
  SleepSession,
} from '../database/types'
import { activeDurationMs, formatDuration } from '../stopwatch/duration'
import { messages } from '../i18n'
import { resolveDisplayZone } from '../settings/displayTimezone'
import type { DisplayTimezone } from '../settings/displayTimezone'
import { LOCATION_VISIT, placeTypeLabel } from '../location/location'
import { formatInTimezone, getUtcOffsetMinutes, offsetToZoneName } from '../time/time'

/**
 * Personal Data Log: display rows, search, filters, sorting and paging.
 * Pure functions, independent of React and of the database.
 *
 * Conventions:
 * - Dates and times are shown in the display timezone chosen in Settings
 *   (by default, each entry's own event timezone).
 * - The date filter compares those displayed local dates, inclusive at
 *   both ends, so what you filter is what you see.
 * - The default order is newest first; ties are broken by start instant
 *   and then by id so the order is always deterministic.
 */

/* Getters: the text of the current language is read when used (sharing plan S2i). */
export const HABIT_TYPE_LABELS: Record<HabitType, string> = {
  get number() { return messages().habitTypes.number },
  get checkbox() { return messages().habitTypes.checkbox },
  get stopwatch() { return messages().habitTypes.stopwatch },
  get label() { return messages().habitTypes.label },
  get text() { return messages().habitTypes.text },
}

function sourceLabel(source: DataSource): string {
  return messages().labels.sources[source]
}

/** Habit id used for sleep rows (sleep is not a habit). */
export const SLEEP_ROW_HABIT_ID = '__sleep__'

/** Habit id used for screen-time rows (screen time is not a habit). */
export const SCREEN_TIME_ROW_HABIT_ID = '__screen_time__'

/** Habit id used for location rows (visits and movements). */
export const LOCATION_ROW_HABIT_ID = '__location__'

/** A row's type: a habit type, "sleep", "screen_time" or "location". */
export type LogRowType = HabitType | 'sleep' | 'screen_time' | 'location'

export interface LogRow {
  id: string
  /** Whether the row is a habit entry, a sleep session or a screen-time day. */
  kind: 'entry' | 'sleep' | 'screen_time' | 'location'
  occurredStart: string

  /** Local date in the display timezone, "YYYY-MM-DD" (for filtering). */
  localDate: string
  /** Local date for display, e.g. "Mon 9 Nov 2026". */
  dateLabel: string
  /** "14:30", or "08:00–09:05" for stopwatch entries. */
  timeLabel: string

  /** The event timezone (where the entry happened). */
  timezone: string
  /**
   * True when the event timezone should be named next to the time:
   * - showing event timezones: when it differs from the device;
   * - showing one chosen timezone: when it differs from that timezone.
   */
  showTimezone: boolean

  habitId: string
  habitName: string
  habitArchived: boolean
  habitType: LogRowType
  typeLabel: string

  valueLabel: string
  /** Value used for sorting: numbers sort before text. */
  sortValue: number | string

  unit: string
  sourceLabel: string
  comment: string
}

function describeValue(entry: Entry): { label: string; sort: number | string } {
  switch (entry.habitType) {
    case 'number':
      return { label: String(entry.value), sort: entry.value }

    case 'checkbox':
      return {
        label: entry.value ? messages().logRows.done : messages().logRows.notDone,
        sort: entry.value ? 1 : 0,
      }

    case 'label':
    case 'text':
      return { label: entry.value, sort: entry.value.toLocaleLowerCase() }

    case 'stopwatch': {
      const durationMs = activeDurationMs(entry.value.segments)
      const periods = entry.value.segments.length
      const suffix = periods > 1 ? ` (${periods} periods)` : ''

      return { label: `${formatDuration(durationMs)}${suffix}`, sort: durationMs }
    }
  }
}

export function toLogRow(
  entry: Entry,
  habit: Habit,
  deviceTimezone: string,
  displayTimezone: DisplayTimezone = 'event',
): LogRow {
  const zone = resolveDisplayZone(displayTimezone, entry.timezone, deviceTimezone)
  const localDate = formatInTimezone(entry.occurredStart, zone, 'yyyy-MM-dd')
  let timeLabel = formatInTimezone(entry.occurredStart, zone, 'HH:mm')

  if (entry.habitType === 'stopwatch') {
    const endDate = formatInTimezone(entry.occurredEnd, zone, 'yyyy-MM-dd')
    const endTime = formatInTimezone(entry.occurredEnd, zone, 'HH:mm')

    timeLabel += `–${endTime}${endDate !== localDate ? ' (next day or later)' : ''}`
  }

  const value = describeValue(entry)

  return {
    id: entry.id,
    kind: 'entry',
    occurredStart: entry.occurredStart,
    localDate,
    dateLabel: formatInTimezone(entry.occurredStart, zone, 'EEE d MMM yyyy'),
    timeLabel,
    timezone: entry.timezone,
    showTimezone:
      displayTimezone === 'event'
        ? entry.timezone !== deviceTimezone
        : entry.timezone !== zone,
    habitId: habit.id,
    habitName: habit.name,
    habitArchived: habit.archived,
    habitType: entry.habitType,
    typeLabel: HABIT_TYPE_LABELS[entry.habitType],
    valueLabel: value.label,
    sortValue: value.sort,
    unit: habit.type === 'number' ? (habit.unit ?? '') : '',
    sourceLabel: sourceLabel(entry.source),
    comment: entry.comment ?? '',
  }
}

/**
 * A sleep session as a log row. Its value is the time in bed; the sleep
 * duration (which may exclude awake periods) is calculated by the sleep
 * engine.
 */
export function toSleepLogRow(
  session: SleepSession,
  deviceTimezone: string,
  displayTimezone: DisplayTimezone = 'event',
): LogRow {
  const eventZone = sleepSessionZone(session)
  const zone = resolveDisplayZone(displayTimezone, eventZone, deviceTimezone)
  const localDate = formatInTimezone(session.startUtc, zone, 'yyyy-MM-dd')
  const endDate = formatInTimezone(session.endUtc, zone, 'yyyy-MM-dd')
  const durationMs = Date.parse(session.endUtc) - Date.parse(session.startUtc)

  return {
    id: session.id,
    kind: 'sleep',
    occurredStart: session.startUtc,
    localDate,
    dateLabel: formatInTimezone(session.startUtc, zone, 'EEE d MMM yyyy'),
    timeLabel:
      `${formatInTimezone(session.startUtc, zone, 'HH:mm')}–` +
      `${formatInTimezone(session.endUtc, zone, 'HH:mm')}` +
      (endDate !== localDate ? messages().logRows.nextDay : ''),
    timezone: eventZone,
    showTimezone:
      displayTimezone === 'event' ? eventZone !== deviceTimezone : eventZone !== zone,
    habitId: SLEEP_ROW_HABIT_ID,
    habitName: messages().logRows.sleep,
    habitArchived: false,
    habitType: 'sleep',
    typeLabel: messages().logRows.sleep,
    valueLabel: messages().logRows.inBed(formatDuration(durationMs)),
    sortValue: durationMs,
    unit: '',
    sourceLabel: sourceLabel(session.source),
    comment: session.comment ?? '',
  }
}

/**
 * A screen-time day as a log row. It always shows its own calendar day
 * (the day as lived, in the timezone it was recorded in), whatever the
 * display timezone: a day has no time of day to convert.
 */
export function toScreenTimeLogRow(
  sample: ExternalSample,
  deviceTimezone: string,
  displayTimezone: DisplayTimezone = 'event',
): LogRow {
  const eventZone = sample.timezone ?? 'UTC'
  const zone = resolveDisplayZone(displayTimezone, eventZone, deviceTimezone)
  const localDate = typeof sample.metadata?.localDate === 'string'
    ? sample.metadata.localDate
    : formatInTimezone(sample.startUtc, eventZone, 'yyyy-MM-dd')
  const apps = Array.isArray(sample.metadata?.apps) ? sample.metadata.apps.length : null
  const durationMs = sample.value * 1000

  return {
    id: sample.id,
    kind: 'screen_time',
    occurredStart: sample.startUtc,
    localDate,
    dateLabel: formatInTimezone(sample.startUtc, eventZone, 'EEE d MMM yyyy'),
    timeLabel: messages().logRows.wholeDay,
    timezone: eventZone,
    showTimezone: displayTimezone === 'event' ? eventZone !== deviceTimezone : eventZone !== zone,
    habitId: SCREEN_TIME_ROW_HABIT_ID,
    habitName: messages().logRows.screenTime,
    habitArchived: false,
    habitType: 'screen_time',
    typeLabel: messages().logRows.screenTime,
    valueLabel: formatDuration(durationMs) + (apps === null ? '' : messages().logRows.apps(apps)),
    sortValue: durationMs,
    unit: '',
    // Files name the app they came from ("Import (App Usage)"); the phone is just "Phone".
    sourceLabel: sourceLabel(sample.source) + (sample.source === 'import' && sample.sourceApp ? ` (${sample.sourceApp})` : ''),
    comment: '',
  }
}

/**
 * A location visit or movement as a log row. The export gives UTC offsets
 * (no time zone name): times are read at that offset; the offset is named
 * only when it differs from the zone used for display at that moment.
 */
export function toLocationLogRow(
  sample: ExternalSample,
  deviceTimezone: string,
  displayTimezone: DisplayTimezone = 'event',
): LogRow {
  const offset = sample.startOffsetMinutes ?? 0
  const eventZone = offsetToZoneName(offset)
  const zone = resolveDisplayZone(displayTimezone, eventZone, deviceTimezone)
  const end = sample.endUtc ?? sample.startUtc
  const localDate = formatInTimezone(sample.startUtc, zone, 'yyyy-MM-dd')
  const endDate = formatInTimezone(end, zone, 'yyyy-MM-dd')
  const durationMs = Date.parse(end) - Date.parse(sample.startUtc)
  const compareZone = displayTimezone === 'event' ? deviceTimezone : zone
  const isVisit = sample.measurementType === LOCATION_VISIT
  const meta = sample.metadata ?? {}

  return {
    id: sample.id,
    kind: 'location',
    occurredStart: sample.startUtc,
    localDate,
    dateLabel: formatInTimezone(sample.startUtc, zone, 'EEE d MMM yyyy'),
    timeLabel:
      `${formatInTimezone(sample.startUtc, zone, 'HH:mm')}–${formatInTimezone(end, zone, 'HH:mm')}` +
      (endDate !== localDate ? messages().logRows.nextDay : ''),
    timezone: eventZone,
    showTimezone: getUtcOffsetMinutes(sample.startUtc, compareZone) !== offset,
    habitId: LOCATION_ROW_HABIT_ID,
    habitName: messages().logRows.location,
    habitArchived: false,
    habitType: 'location',
    typeLabel: isVisit ? messages().logRows.visit : messages().logRows.movement,
    valueLabel: isVisit
      ? `${placeTypeLabel(String(meta.semanticType))} · ${formatDuration(durationMs)}`
      : `${placeTypeLabel(String(meta.activityType))} · ${(sample.value / 1000).toFixed(1)} km · ${formatDuration(durationMs)}`,
    sortValue: isVisit ? durationMs : sample.value,
    unit: '',
    sourceLabel: sourceLabel(sample.source) + (sample.sourceApp ? ` (${sample.sourceApp})` : ''),
    comment: '',
  }
}

export type SortColumn = 'date' | 'habit' | 'type' | 'value' | 'source'
export type SortDirection = 'asc' | 'desc'

export interface LogCriteria {
  search: string
  habitId: string | 'all'
  habitType: LogRowType | 'all'
  /** Inclusive local dates "YYYY-MM-DD", or "" for no limit. */
  fromDate: string
  toDate: string
  sortColumn: SortColumn
  sortDirection: SortDirection
  /** 1-based page number. */
  page: number
  pageSize: number
}

export const DEFAULT_LOG_CRITERIA: LogCriteria = {
  search: '',
  habitId: 'all',
  habitType: 'all',
  fromDate: '',
  toDate: '',
  sortColumn: 'date',
  sortDirection: 'desc',
  page: 1,
  pageSize: 50,
}

export interface LogPage {
  rows: LogRow[]
  /** Number of rows matching the search and filters. */
  total: number
  /** The page actually shown (clamped to the available pages). */
  page: number
  pageCount: number
}

function compareSortValues(a: number | string, b: number | string): number {
  if (typeof a === 'number' && typeof b === 'number') {
    return a - b
  }

  if (typeof a === 'string' && typeof b === 'string') {
    return a.localeCompare(b)
  }

  // Numbers before text.
  return typeof a === 'number' ? -1 : 1
}

function compareRows(a: LogRow, b: LogRow, column: SortColumn): number {
  switch (column) {
    case 'date':
      return a.occurredStart.localeCompare(b.occurredStart)
    case 'habit':
      return a.habitName.localeCompare(b.habitName)
    case 'type':
      return a.typeLabel.localeCompare(b.typeLabel)
    case 'value':
      return compareSortValues(a.sortValue, b.sortValue)
    case 'source':
      return a.sourceLabel.localeCompare(b.sourceLabel)
  }
}

function matchesSearch(row: LogRow, search: string): boolean {
  if (search === '') {
    return true
  }

  return [row.habitName, row.valueLabel, row.unit, row.comment, row.typeLabel]
    .some((field) => field.toLocaleLowerCase().includes(search))
}

/**
 * Applies search, filters and sorting, then returns one page.
 */
export function filterSortPage(rows: LogRow[], criteria: LogCriteria): LogPage {
  const search = criteria.search.trim().toLocaleLowerCase()

  const matching = rows.filter(
    (row) =>
      (criteria.habitId === 'all' || row.habitId === criteria.habitId) &&
      (criteria.habitType === 'all' || row.habitType === criteria.habitType) &&
      (criteria.fromDate === '' || row.localDate >= criteria.fromDate) &&
      (criteria.toDate === '' || row.localDate <= criteria.toDate) &&
      matchesSearch(row, search),
  )

  const direction = criteria.sortDirection === 'asc' ? 1 : -1

  matching.sort(
    (a, b) =>
      direction * compareRows(a, b, criteria.sortColumn) ||
      // Deterministic tie-breakers: newest first, then id.
      b.occurredStart.localeCompare(a.occurredStart) ||
      a.id.localeCompare(b.id),
  )

  const pageSize = Math.max(1, Math.floor(criteria.pageSize))
  const pageCount = Math.max(1, Math.ceil(matching.length / pageSize))
  const page = Math.min(Math.max(1, Math.floor(criteria.page)), pageCount)
  const start = (page - 1) * pageSize

  return {
    rows: matching.slice(start, start + pageSize),
    total: matching.length,
    page,
    pageCount,
  }
}
