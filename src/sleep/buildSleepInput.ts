import { messages } from '../i18n'
import { cleanComment } from '../logging/commentTemplate'
import type { ManualSleepInput } from '../database/sleepSessions'
import { MAX_SLEEP_SESSION_MS } from '../database/validation'
import { buildTimeRange } from '../logging/buildTimeRange'
import type { TimeRangeForm } from '../logging/buildTimeRange'

/**
 * Converts the "Log sleep" form into the input of
 * createManualSleepSession. Pure function.
 */

export interface SleepForm extends TimeRangeForm {
  comment: string
}

export interface BuiltSleep {
  input: ManualSleepInput
  durationMs: number
  ambiguousTime: boolean
}

/** Nights longer than this show a non-blocking "check the dates" warning. */
export const LONG_SLEEP_MS = 14 * 60 * 60 * 1000

export function buildSleepInput(form: SleepForm): BuiltSleep {
  const range = buildTimeRange(form, 'sleep')

  if (range.durationMs > MAX_SLEEP_SESSION_MS) {
    throw new Error(messages().validation.sleepTooLong)
  }

  return {
    input: {
      startUtc: range.startUtc,
      endUtc: range.endUtc,
      timezone: form.timezone.trim(),
      comment: cleanComment(form.comment),
    },
    durationMs: range.durationMs,
    ambiguousTime: range.ambiguousTime,
  }
}
