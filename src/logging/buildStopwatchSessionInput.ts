import { messages } from '../i18n'
import { cleanComment } from './commentTemplate'
import type { CreateEntryInput } from '../database/entries'
import type { Habit } from '../database/types'
import { buildTimeRange } from './buildTimeRange'

/**
 * Converts the "Log a past session" form of a stopwatch habit into the
 * input of createEntry (a single active period). Pure function.
 *
 * Start and end are wall-clock times in the same timezone. The duration
 * is the actual time between the two UTC instants, so a session across a
 * daylight-saving change is measured correctly.
 */

export interface StopwatchSessionForm {
  startDate: string
  startTime: string
  endDate: string
  endTime: string
  timezone: string
  comment: string
}

export interface BuiltStopwatchSession {
  input: CreateEntryInput
  durationMs: number

  /** True if the start or end time occurs twice (clocks going back). */
  ambiguousTime: boolean
}

/** Sessions longer than this trigger a "check the dates" warning. */
export const LONG_SESSION_MS = 24 * 60 * 60 * 1000

export function buildStopwatchSessionInput(
  habit: Habit,
  form: StopwatchSessionForm,
): BuiltStopwatchSession {
  if (habit.type !== 'stopwatch') {
    throw new Error(messages().inputText.onlyStopwatchSessions)
  }

  const range = buildTimeRange(form)

  return {
    input: {
      habitId: habit.id,
      value: null,
      occurredStart: range.startUtc,
      occurredEnd: range.endUtc,
      timezone: form.timezone.trim(),
      comment: cleanComment(form.comment),
    },
    durationMs: range.durationMs,
    ambiguousTime: range.ambiguousTime,
  }
}
