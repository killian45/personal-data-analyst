
import { db } from './db'
import { messages } from '../i18n'

import type {
  ActiveTimer,
  Entry,
} from './types'

import { createEntry } from './entries'
import { getDeviceTimezone } from '../time/time'
import {
  normalizeComment,
  normalizeTimestamp,
  validateTimezone,
} from './validation'

export interface StartStopwatchOptions {
  startedAt?: string
  timezone?: string
  comment?: string | null
}

/**
 * Starts a stopwatch and persists it in IndexedDB.
 */
export async function startStopwatch(
  habitId: string,
  options: StartStopwatchOptions = {},
): Promise<ActiveTimer> {
  const startedAt = normalizeTimestamp(
    options.startedAt ?? new Date().toISOString(),
  )

  const timezone = validateTimezone(
    options.timezone ?? getDeviceTimezone(),
  )

  const comment = normalizeComment(options.comment)

  return db.transaction(
    'rw',
    db.habits,
    db.activeTimers,
    async () => {
      const habit = await db.habits.get(habitId)

      if (!habit || habit.deletedAt !== null) {
        throw new Error(messages().dbText.habitNotFound)
      }

      if (habit.archived) {
        throw new Error(
          messages().dbText.archivedNoStopwatch,
        )
      }

      if (habit.type !== 'stopwatch') {
        throw new Error(
          messages().dbText.onlyStopwatchHabits,
        )
      }

      const existingTimer =
        await db.activeTimers.get(habitId)

      if (existingTimer) {
        throw new Error(
          messages().dbText.alreadyRunning,
        )
      }

      const now = new Date().toISOString()

      const timer: ActiveTimer = {
        habitId,
        startedAt,
        timezone,
        comment,
        completedSegments: [],
        runningSince: startedAt,
        createdAt: now,
        updatedAt: now,
      }

      await db.activeTimers.add(timer)

      return timer
    },
  )
}

/**
 * Retrieves all active stopwatches.
 */
export async function getActiveStopwatches(): Promise<
  ActiveTimer[]
> {
  return db.activeTimers.toArray()
}

/**
 * Retrieves the active stopwatch for one habit.
 */
export async function getActiveStopwatch(
  habitId: string,
): Promise<ActiveTimer | undefined> {
  return db.activeTimers.get(habitId)
}

async function getTimerOrThrow(habitId: string): Promise<ActiveTimer> {
  const timer = await db.activeTimers.get(habitId)

  if (!timer) {
    throw new Error(messages().dbText.noActiveStopwatch)
  }

  return timer
}

/**
 * Stops a stopwatch, creates a completed entry and removes the active
 * timer atomically. The entry has a single period from start to stop.
 *
 * Pause/resume was removed (PROJECT_SPEC.md §4.4). A timer paused with
 * an earlier version still stops correctly: its entry keeps the periods
 * recorded before the pause and ends at the pause.
 */
export async function stopStopwatch(
  habitId: string,
): Promise<Entry> {
  return db.transaction(
    'rw',
    db.habits,
    db.entries,
    db.activeTimers,
    async () => {
      const timer = await getTimerOrThrow(habitId)
      const segments = [...timer.completedSegments]

      if (timer.runningSince !== null) {
        const stoppedAt = new Date().toISOString()

        if (Date.parse(stoppedAt) <= Date.parse(timer.runningSince)) {
          throw new Error(
            messages().dbText.durationPositive,
          )
        }

        segments.push({ start: timer.runningSince, end: stoppedAt })
      }

      if (segments.length === 0) {
        throw new Error(
          messages().dbText.durationPositive,
        )
      }

      const entry = await createEntry({
        habitId,
        value: { segments },
        timezone: timer.timezone,
        comment: timer.comment,
      })

      await db.activeTimers.delete(habitId)

      return entry
    },
  )
}

/**
 * Cancels an active stopwatch without creating an entry.
 */
export async function cancelStopwatch(
  habitId: string,
): Promise<void> {
  await db.activeTimers.delete(habitId)
}
