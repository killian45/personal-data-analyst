import { messages } from '../i18n'
import { elapsedMilliseconds, localDateTimeToUtc } from '../time/time'

import { combineDateAndTime } from './dateTimeInput'

/**
 * Reads a start and an end typed as dd/mm/yyyy dates and 24-hour times in
 * one timezone, and returns UTC instants. Pure function, shared by the
 * "Log a past session" and "Log sleep" forms.
 *
 * The duration is the actual time between the two UTC instants, so a
 * range across a daylight-saving change is measured correctly.
 */

export interface TimeRangeForm {
  startDate: string
  startTime: string
  endDate: string
  endTime: string
  timezone: string
}

/** Words used in error messages, e.g. "start"/"end" or "bedtime"/"wake time". */
/** Which texts the messages use: a stopwatch session (start/end) or sleep (bedtime/wake time). */
export type TimeRangeKind = 'session' | 'sleep'

export interface TimeRange {
  startUtc: string
  endUtc: string
  durationMs: number
  /** True if the start or end time occurs twice (clocks going back). */
  ambiguousTime: boolean
}

function toUtc(
  kind: TimeRangeKind,
  which: 'start' | 'end',
  date: string,
  time: string,
  timezone: string,
): { utc: string; ambiguous: boolean } {
  const local = combineDateAndTime(date, time)

  if (local === null) {
    const texts = messages().inputText.timeRange[kind]
    throw new Error(which === 'start' ? texts.invalidStart : texts.invalidEnd)
  }

  try {
    return localDateTimeToUtc(local, timezone)
  } catch (caughtError) {
    const t = messages().inputText
    const message = caughtError instanceof Error ? caughtError.message : t.invalidTime
    throw new Error(t.prefixed(t.timeRange[kind][which], message))
  }
}

export function buildTimeRange(
  form: TimeRangeForm,
  kind: TimeRangeKind = 'session',
): TimeRange {
  const timezone = form.timezone.trim()
  const start = toUtc(kind, 'start', form.startDate, form.startTime, timezone)
  const end = toUtc(kind, 'end', form.endDate, form.endTime, timezone)
  const durationMs = elapsedMilliseconds(start.utc, end.utc)

  if (durationMs <= 0) {
    throw new Error(messages().inputText.timeRange[kind].order)
  }

  return {
    startUtc: start.utc,
    endUtc: end.utc,
    durationMs,
    ambiguousTime: start.ambiguous || end.ambiguous,
  }
}
