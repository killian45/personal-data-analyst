import { db } from '../database/db'
import type { Entry, Habit, SleepSession } from '../database/types'
import { LOCATION_TYPES } from '../location/location'
import { SCREEN_TIME_DAILY } from '../screenTime/screenTime'
import type { DisplayTimezone } from '../settings/displayTimezone'
import { getDeviceTimezone } from '../time/time'

import { toLocationLogRow, toLogRow, toScreenTimeLogRow, toSleepLogRow } from './logRows'
import type { LogRow } from './logRows'

export interface LogData {
  rows: LogRow[]
  /** Non-deleted habits (active and archived), for the habit filter. */
  habits: Habit[]
  /** The original records of the listed rows, for editing. */
  entriesById: Map<string, Entry>
  sleepById: Map<string, SleepSession>
  /** Whether any screen-time day is listed (for the filters). */
  hasScreenTime: boolean
  /** Whether any location visit or movement is listed (for the filters). */
  hasLocation: boolean
}

/**
 * Loads the rows of the Personal Data Log.
 *
 * - Soft-deleted entries are excluded.
 * - Entries of deleted habits are excluded (the habit no longer appears
 *   in the application); they remain stored and in backups.
 * - Entries of archived habits are included.
 * - Non-deleted sleep sessions are included as "Sleep" rows.
 * - Non-deleted screen-time days are included as "Screen time" rows.
 * - Non-deleted location visits and movements are included as "Location" rows.
 *
 * Limitation: matching records are held in memory for searching and
 * sorting (only one page is rendered). This is fine for personal-scale
 * data; index-based paging can be added if it becomes slow.
 */
export async function loadLogRows(
  displayTimezone: DisplayTimezone = 'event',
): Promise<LogData> {
  return db.transaction('r', db.habits, db.entries, db.sleepSessions, db.externalSamples, async () => {
    const habits = (await db.habits.toArray())
      .filter((habit) => habit.deletedAt === null)
      .sort((a, b) => a.name.localeCompare(b.name))

    const habitsById = new Map(habits.map((habit) => [habit.id, habit]))
    const deviceTimezone = getDeviceTimezone()
    const rows: LogRow[] = []
    const entriesById = new Map<string, Entry>()

    await db.entries.each((entry) => {
      const habit = habitsById.get(entry.habitId)

      if (entry.deletedAt === null && habit) {
        rows.push(toLogRow(entry, habit, deviceTimezone, displayTimezone))
        entriesById.set(entry.id, entry)
      }
    })

    const sleepById = new Map<string, SleepSession>()

    await db.sleepSessions.each((session) => {
      if (session.deletedAt === null) {
        rows.push(toSleepLogRow(session, deviceTimezone, displayTimezone))
        sleepById.set(session.id, session)
      }
    })

    let hasScreenTime = false
    await db.externalSamples.where('measurementType').equals(SCREEN_TIME_DAILY).each((sample) => {
      if (sample.deletedAt === null) {
        rows.push(toScreenTimeLogRow(sample, deviceTimezone, displayTimezone))
        hasScreenTime = true
      }
    })

    let hasLocation = false
    await db.externalSamples.where('measurementType').anyOf([...LOCATION_TYPES]).each((sample) => {
      if (sample.deletedAt === null) {
        rows.push(toLocationLogRow(sample, deviceTimezone, displayTimezone))
        hasLocation = true
      }
    })

    return { rows, habits, entriesById, sleepById, hasScreenTime, hasLocation }
  })
}
