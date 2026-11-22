import { messages } from '../i18n'
import { cleanComment, commentForEditing } from '../logging/commentTemplate'
import type { SleepSessionChanges } from '../database/sleepSessions'
import { sleepSessionZone } from '../database/sleepSessions'
import type { SleepSession } from '../database/types'
import { MAX_SLEEP_SESSION_MS } from '../database/validation'
import {
  combineDateAndTime,
  invalidDateTimeMessage,
  splitLocalDateTime,
} from '../logging/dateTimeInput'
import { localDateTimeToUtc, utcToLocalDateTime } from '../time/time'

/**
 * Editing a sleep session. Pure functions.
 *
 * - Only changed fields are sent; an unchanged bedtime or wake time keeps
 *   its exact original instant.
 * - Changing the timezone of a manual session keeps the wall-clock times
 *   and recalculates the instants.
 * - Imported sessions: only the comment can change.
 */

export interface SleepEditForm {
  startDate: string
  startTime: string
  endDate: string
  endTime: string
  timezone: string
  comment: string
}

export interface BuiltSleepUpdate {
  changes: SleepSessionChanges
  ambiguousTime: boolean
}

export function initialSleepEditForm(session: SleepSession): SleepEditForm {
  const zone = sleepSessionZone(session)
  const start = splitLocalDateTime(utcToLocalDateTime(session.startUtc, zone))
  const end = splitLocalDateTime(utcToLocalDateTime(session.endUtc, zone))

  return {
    startDate: start.date,
    startTime: start.time,
    endDate: end.date,
    endTime: end.time,
    timezone: zone,
    comment: commentForEditing(session.comment),
  }
}

function convert(date: string, time: string, timezone: string, prefix: string) {
  const local = combineDateAndTime(date, time)

  if (local === null) {
    throw new Error(`${prefix}${invalidDateTimeMessage()}`)
  }

  try {
    return localDateTimeToUtc(local, timezone)
  } catch (caughtError) {
    const message = caughtError instanceof Error ? caughtError.message : messages().inputText.invalidTime
    throw new Error(`${prefix}${message}`)
  }
}

export function buildSleepUpdate(session: SleepSession, form: SleepEditForm): BuiltSleepUpdate {
  const initial = initialSleepEditForm(session)
  const changes: SleepSessionChanges = {}
  let ambiguousTime = false

  const comment = cleanComment(form.comment)

  if (comment !== (session.comment ?? '')) {
    changes.comment = comment
  }

  if (session.source !== 'manual') {
    return { changes, ambiguousTime }
  }

  const timezone = form.timezone.trim()
  const timezoneChanged = timezone !== initial.timezone

  if (timezoneChanged) {
    changes.timezone = timezone
  }

  const startChanged =
    timezoneChanged ||
    combineDateAndTime(form.startDate, form.startTime) !==
      combineDateAndTime(initial.startDate, initial.startTime)

  const endChanged =
    timezoneChanged ||
    combineDateAndTime(form.endDate, form.endTime) !==
      combineDateAndTime(initial.endDate, initial.endTime)

  if (startChanged) {
    const start = convert(form.startDate, form.startTime, timezone, `${messages().inputText.timeRange.sleep.start}: `)
    changes.startUtc = start.utc
    ambiguousTime ||= start.ambiguous
  }

  if (endChanged) {
    const end = convert(form.endDate, form.endTime, timezone, `${messages().inputText.timeRange.sleep.end}: `)
    changes.endUtc = end.utc
    ambiguousTime ||= end.ambiguous
  }

  const durationMs =
    Date.parse(changes.endUtc ?? session.endUtc) - Date.parse(changes.startUtc ?? session.startUtc)

  if (durationMs <= 0) {
    throw new Error(messages().validation.wakeAfterBed)
  }

  if (durationMs > MAX_SLEEP_SESSION_MS) {
    throw new Error(messages().validation.sleepTooLong)
  }

  return { changes, ambiguousTime }
}
