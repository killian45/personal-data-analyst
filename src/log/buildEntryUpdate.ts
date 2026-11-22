import { messages } from '../i18n'
import { cleanComment, commentForEditing } from '../logging/commentTemplate'
import type { UpdateEntryInput } from '../database/entries'
import type { Entry, Habit } from '../database/types'
import { parseFormValue } from '../logging/buildEntryInput'
import {
  combineDateAndTime,
  invalidDateTimeMessage,
  splitLocalDateTime,
} from '../logging/dateTimeInput'
import { localDateTimeToUtc, utcToLocalDateTime } from '../time/time'

/**
 * Editing an existing entry. Pure functions.
 *
 * Rules:
 * - Only fields the user actually changed are sent to the database. In
 *   particular, an unchanged date/time keeps the original instant exactly
 *   (including seconds), even though the form only shows minutes.
 * - The form shows wall-clock times in the entry's timezone. Changing the
 *   timezone keeps the same wall-clock time and recalculates the instant
 *   ("it was 14:30 in Tokyo, not in Paris").
 * - Stopwatch sessions with pauses (several periods): changing the start
 *   moves the beginning of the first period and changing the end moves
 *   the end of the last period; the pauses in between are kept. For these
 *   sessions, changing only the timezone does not move any period (it
 *   changes how the times are displayed); a changed start or end is read
 *   in the chosen timezone.
 */

export interface EntryEditForm {
  /** number/text: typed text; checkbox: true/false; label: option. */
  rawValue: string | boolean
  /** Start (or only) date dd/mm/yyyy and 24-hour time. */
  date: string
  time: string
  /** Stopwatch end; empty for other habit types. */
  endDate: string
  endTime: string
  timezone: string
  comment: string
}

export interface BuiltEntryUpdate {
  /** Only the changed fields; empty when nothing changed. */
  changes: UpdateEntryInput
  /** True if a changed time occurs twice (clocks going back). */
  ambiguousTime: boolean
}

/** True for a stopwatch session with pauses (more than one period). */
export function hasPauses(entry: Entry): boolean {
  return entry.habitType === 'stopwatch' && entry.value.segments.length > 1
}

/** The form fields as they are when editing starts. */
export function initialEditForm(entry: Entry): EntryEditForm {
  const start = splitLocalDateTime(
    utcToLocalDateTime(entry.occurredStart, entry.timezone),
  )

  const end = entry.habitType === 'stopwatch'
    ? splitLocalDateTime(utcToLocalDateTime(entry.occurredEnd, entry.timezone))
    : { date: '', time: '' }

  let rawValue: string | boolean = ''

  switch (entry.habitType) {
    case 'number':
      rawValue = String(entry.value)
      break
    case 'checkbox':
    case 'label':
    case 'text':
      rawValue = entry.value
      break
    case 'stopwatch':
      rawValue = ''
      break
  }

  return {
    rawValue,
    date: start.date,
    time: start.time,
    endDate: end.date,
    endTime: end.time,
    timezone: entry.timezone,
    comment: commentForEditing(entry.comment),
  }
}

function convert(
  date: string,
  time: string,
  timezone: string,
  prefix: string,
): { utc: string; ambiguous: boolean } {
  const local = combineDateAndTime(date, time)

  if (local === null) {
    throw new Error(`${prefix}${invalidDateTimeMessage()}`)
  }

  try {
    return localDateTimeToUtc(local, timezone)
  } catch (caughtError) {
    const message =
      caughtError instanceof Error ? caughtError.message : messages().inputText.invalidTime
    throw new Error(`${prefix}${message}`)
  }
}

export function buildEntryUpdate(
  entry: Entry,
  habit: Habit,
  form: EntryEditForm,
): BuiltEntryUpdate {
  const initial = initialEditForm(entry)
  const changes: UpdateEntryInput = {}
  let ambiguousTime = false

  const timezone = form.timezone.trim()
  const timezoneChanged = timezone !== entry.timezone

  if (timezoneChanged) {
    changes.timezone = timezone
  }

  const comment = cleanComment(form.comment)

  if (comment !== (entry.comment ?? '')) {
    changes.comment = comment
  }

  if (entry.habitType !== 'stopwatch' && form.rawValue !== initial.rawValue) {
    changes.value = parseFormValue(habit, form.rawValue)
  }

  const isStopwatch = entry.habitType === 'stopwatch'
  const paused = hasPauses(entry)

  // For sessions with pauses, a timezone change alone moves nothing.
  const timezoneMovesTimes = timezoneChanged && !paused

  // Compare normalised values, so "14h30" equals "14:30".
  const startChanged =
    timezoneMovesTimes ||
    combineDateAndTime(form.date, form.time) !==
      combineDateAndTime(initial.date, initial.time)

  if (startChanged) {
    const start = convert(form.date, form.time, timezone, isStopwatch ? `${messages().inputText.timeRange.session.start}: ` : '')
    changes.occurredStart = start.utc
    ambiguousTime ||= start.ambiguous
  }

  if (entry.habitType === 'stopwatch') {
    const endChanged =
      timezoneMovesTimes ||
      combineDateAndTime(form.endDate, form.endTime) !==
        combineDateAndTime(initial.endDate, initial.endTime)

    if (endChanged) {
      const end = convert(form.endDate, form.endTime, timezone, `${messages().inputText.timeRange.session.end}: `)
      changes.occurredEnd = end.utc
      ambiguousTime ||= end.ambiguous
    }

    const effectiveStart = changes.occurredStart ?? entry.occurredStart
    const effectiveEnd = changes.occurredEnd ?? entry.occurredEnd

    if (Date.parse(effectiveEnd) <= Date.parse(effectiveStart)) {
      throw new Error(messages().inputText.timeRange.session.order)
    }

    if (paused && (startChanged || endChanged)) {
      const segments = entry.value.segments.map((segment) => ({ ...segment }))
      const first = segments[0]
      const last = segments[segments.length - 1]

      first.start = effectiveStart
      last.end = effectiveEnd

      if (Date.parse(first.start) >= Date.parse(first.end)) {
        throw new Error(
          messages().inputText.beforeFirstPause(utcToLocalDateTime(first.end, timezone).slice(11, 16)),
        )
      }

      if (Date.parse(last.end) <= Date.parse(last.start)) {
        throw new Error(
          messages().inputText.afterLastPause(utcToLocalDateTime(last.start, timezone).slice(11, 16)),
        )
      }

      // The database derives start and end from the periods.
      delete changes.occurredStart
      delete changes.occurredEnd
      changes.value = { segments }
    }
  }

  return { changes, ambiguousTime }
}
