import { messages } from '../i18n'
import { db } from '../database/db'
import { activeSettingValue, putSetting, removeSetting } from '../database/settings'
import { parseTime24 } from '../logging/dateTimeInput'

/**
 * Optional personal sleep targets (PROJECT_SPEC.md §8.2), stored in the
 * settings table (so they are included in backups):
 *
 * - "target.sleepDuration": duration "H:MM" (e.g. "7:30" = 7 h 30 min)
 * - "target.bedtime":       clock time "HH:mm"
 * - "target.wakeTime":      clock time "HH:mm"
 *
 * A missing setting means "no target".
 */

export const SLEEP_TARGET_KEYS = {
  sleepDuration: 'target.sleepDuration',
  bedtime: 'target.bedtime',
  wakeTime: 'target.wakeTime',
} as const

export type SleepTargetName = keyof typeof SLEEP_TARGET_KEYS

export interface SleepTargets {
  /** Target sleep duration in minutes. */
  sleepDurationMinutes: number | null
  bedtime: string | null
  wakeTime: string | null
}

const DURATION = /^(\d{1,2})(?:[:hH.](\d{2}))?$/

/**
 * Reads a duration typed as "7:30", "7h30" or "8" (hours) and returns
 * minutes, or null if invalid. Between 0:01 and 23:59.
 */
export function parseDurationHM(text: string): number | null {
  const match = DURATION.exec(text.trim())

  if (!match) {
    return null
  }

  const hours = Number(match[1])
  const minutes = match[2] === undefined ? 0 : Number(match[2])
  const total = hours * 60 + minutes

  return minutes <= 59 && total >= 1 && total < 24 * 60 ? total : null
}

/** Formats minutes as "H:MM". */
export function formatDurationHM(minutes: number): string {
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`
}

/** True when `value` is valid for the target setting `key`. */
export function isValidSleepTargetValue(key: string, value: string): boolean {
  if (key === SLEEP_TARGET_KEYS.sleepDuration) {
    return parseDurationHM(value) !== null && formatDurationHM(parseDurationHM(value) ?? 0) === value
  }

  if (key === SLEEP_TARGET_KEYS.bedtime || key === SLEEP_TARGET_KEYS.wakeTime) {
    return parseTime24(value) === value
  }

  return true
}

/**
 * Places a clock target on the continuous after-midnight axis:
 * - bedtime: before 12:00 counts as after midnight (00:30 → 24.5);
 * - wake time: before 20:00 counts as the next morning (07:00 → 31.0).
 */
export function clockTargetToAxisHours(time: string, kind: 'bedtime' | 'wakeTime'): number {
  const [hours, minutes] = time.split(':').map(Number)
  const value = hours + minutes / 60
  const nextDayBefore = kind === 'bedtime' ? 12 : 20

  return value < nextDayBefore ? value + 24 : value
}

export async function loadSleepTargets(): Promise<SleepTargets> {
  const records = await db.settings.bulkGet(Object.values(SLEEP_TARGET_KEYS))
  const [duration, bedtime, wakeTime] = records.map(activeSettingValue)

  return {
    sleepDurationMinutes: duration === null ? null : parseDurationHM(duration),
    bedtime: bedtime !== null && parseTime24(bedtime) !== null ? parseTime24(bedtime) : null,
    wakeTime: wakeTime !== null && parseTime24(wakeTime) !== null ? parseTime24(wakeTime) : null,
  }
}

export interface SleepTargetTexts {
  sleepDuration: string
  bedtime: string
  wakeTime: string
}

/**
 * Validates and saves the three targets as typed. Empty text removes the
 * target. Nothing is saved if any value is invalid.
 */
export async function saveSleepTargets(texts: SleepTargetTexts): Promise<SleepTargets> {
  const duration = texts.sleepDuration.trim()
  const bedtime = texts.bedtime.trim()
  const wakeTime = texts.wakeTime.trim()

  const durationMinutes = duration === '' ? null : parseDurationHM(duration)
  const bedtimeValue = bedtime === '' ? null : parseTime24(bedtime)
  const wakeValue = wakeTime === '' ? null : parseTime24(wakeTime)

  if (duration !== '' && durationMinutes === null) {
    throw new Error(messages().inputText.durationTarget)
  }

  if (bedtime !== '' && bedtimeValue === null) {
    throw new Error(messages().inputText.bedtimeTarget)
  }

  if (wakeTime !== '' && wakeValue === null) {
    throw new Error(messages().inputText.wakeTarget)
  }

  const values: [string, string | null][] = [
    [SLEEP_TARGET_KEYS.sleepDuration, durationMinutes === null ? null : formatDurationHM(durationMinutes)],
    [SLEEP_TARGET_KEYS.bedtime, bedtimeValue],
    [SLEEP_TARGET_KEYS.wakeTime, wakeValue],
  ]
  const now = new Date()

  await db.transaction('rw', db.settings, async () => {
    for (const [key, value] of values) {
      if (value === null) {
        await removeSetting(key, now)
      } else {
        await putSetting(key, value, now)
      }
    }
  })

  return { sleepDurationMinutes: durationMinutes, bedtime: bedtimeValue, wakeTime: wakeValue }
}
