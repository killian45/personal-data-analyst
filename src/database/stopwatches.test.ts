
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import { db } from './db'
import {
  cancelStopwatch,
  getActiveStopwatch,
  getActiveStopwatches,
  startStopwatch,
  stopStopwatch,
} from './stopwatches'
import { activeDurationMs } from '../stopwatch/duration'
import type { StopwatchEntry } from './types'

import type { Habit, HabitType } from './types'

function makeHabit(
  id: string,
  // Label and number habits are excluded: they need extra fields.
  type: Exclude<HabitType, 'label' | 'number'> = 'stopwatch',
  archived = false,
): Habit {
  const now = new Date().toISOString()

  return {
    id,
    name: `Test habit ${id}`,
    type,
    unit: null,
    labelOptions: null,
    color: '#2563eb',
    sortOrder: 0,
    syncStatus: 'pending',
    revision: 1,
    syncedRevision: null,
    archived,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  }
}

describe('Stopwatch database operations', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(async () => {
    db.close()
    await db.delete()
  })

  describe('startStopwatch', () => {
    it('starts and stores a stopwatch', async () => {
      await db.habits.add(makeHabit('habit-1'))

      const timer = await startStopwatch('habit-1', {
        timezone: 'Europe/Paris',
        comment: 'Morning exercise',
      })

      expect(timer.habitId).toBe('habit-1')
      expect(timer.timezone).toBe('Europe/Paris')
      expect(timer.comment).toBe('Morning exercise')

      const storedTimer = await db.activeTimers.get('habit-1')

      expect(storedTimer).toEqual(timer)
    })

    it('uses the device timezone and no comment when omitted', async () => {
      await db.habits.add(makeHabit('habit-1'))

      const timer = await startStopwatch('habit-1')

      // Tests run with TZ=America/New_York (see vite.config.ts).
      expect(timer.timezone).toBe('America/New_York')
      expect(timer.comment).toBeNull()
    })

    it('rejects a second active stopwatch for the same habit', async () => {
      await db.habits.add(makeHabit('habit-1'))

      await startStopwatch('habit-1')

      await expect(
        startStopwatch('habit-1'),
      ).rejects.toThrow(
        'A stopwatch is already running for this habit.',
      )
    })

    it('allows separate stopwatches for different habits', async () => {
      await db.habits.bulkAdd([
        makeHabit('habit-1'),
        makeHabit('habit-2'),
      ])

      await startStopwatch('habit-1')
      await startStopwatch('habit-2')

      expect(await db.activeTimers.count()).toBe(2)
    })

    it('rejects a habit that does not exist', async () => {
      await expect(
        startStopwatch('missing-habit'),
      ).rejects.toThrow('Habit not found.')
    })

    it('rejects an archived habit', async () => {
      await db.habits.add(
        makeHabit('habit-1', 'stopwatch', true),
      )

      await expect(
        startStopwatch('habit-1'),
      ).rejects.toThrow(
        'Cannot start a stopwatch for an archived habit.',
      )
    })

    it('rejects a habit that is not a stopwatch', async () => {
      await db.habits.add(
        makeHabit('habit-1', 'checkbox'),
      )

      await expect(
        startStopwatch('habit-1'),
      ).rejects.toThrow(
        'Only stopwatch habits can start a stopwatch.',
      )
    })

    it('rejects an invalid timezone', async () => {
      await db.habits.add(makeHabit('habit-1'))

      await expect(
        startStopwatch('habit-1', {
          timezone: 'Not/A_Timezone',
        }),
      ).rejects.toThrow('Invalid IANA timezone.')
    })

    it('rejects a comment longer than 2000 characters', async () => {
      await db.habits.add(makeHabit('habit-1'))

      await expect(
        startStopwatch('habit-1', {
          comment: 'a'.repeat(2001),
        }),
      ).rejects.toThrow(
        'Comment cannot exceed 2000 characters.',
      )
    })
  })

  describe('getActiveStopwatch', () => {
    it('returns the active stopwatch for a habit', async () => {
      await db.habits.add(makeHabit('habit-1'))

      const started = await startStopwatch('habit-1')
      const retrieved = await getActiveStopwatch('habit-1')

      expect(retrieved).toEqual(started)
    })

    it('returns undefined when no stopwatch is active', async () => {
      expect(
        await getActiveStopwatch('habit-1'),
      ).toBeUndefined()
    })
  })

  describe('getActiveStopwatches', () => {
    it('returns all active stopwatches', async () => {
      await db.habits.bulkAdd([
        makeHabit('habit-1'),
        makeHabit('habit-2'),
      ])

      await startStopwatch('habit-1')
      await startStopwatch('habit-2')

      const timers = await getActiveStopwatches()

      expect(timers).toHaveLength(2)
      expect(timers.map((timer) => timer.habitId)).toEqual(
        expect.arrayContaining(['habit-1', 'habit-2']),
      )
    })
  })

  describe('stopStopwatch', () => {
    it('creates a completed entry and removes the active timer', async () => {
      await db.habits.add(makeHabit('habit-1'))

      const startedAt = new Date(
        Date.now() - 60_000,
      ).toISOString()

      await startStopwatch('habit-1', {
        startedAt,
        timezone: 'Europe/Paris',
        comment: 'Exercise session',
      })

      const entry = await stopStopwatch('habit-1')

      expect(entry.habitId).toBe('habit-1')
      expect(entry.value).toEqual({
        segments: [{ start: entry.occurredStart, end: entry.occurredEnd }],
      })
      expect(entry.occurredStart).toBe(
        new Date(startedAt).toISOString(),
      )
      expect(entry.occurredEnd).not.toBeNull()
      expect(Date.parse(entry.occurredEnd!)).toBeGreaterThan(
        Date.parse(entry.occurredStart),
      )
      expect(entry.comment).toBe('Exercise session')

      expect(
        await db.activeTimers.get('habit-1'),
      ).toBeUndefined()

      expect(await db.entries.count()).toBe(1)
    })

    it('rejects when no active stopwatch exists', async () => {
      await expect(
        stopStopwatch('habit-1'),
      ).rejects.toThrow(
        'No active stopwatch found for this habit.',
      )
    })

    it('keeps the active timer if stopping fails', async () => {
      await db.habits.add(makeHabit('habit-1'))

      const futureStart = new Date(
        Date.now() + 60_000,
      ).toISOString()

      await startStopwatch('habit-1', {
        startedAt: futureStart,
      })

      await expect(
        stopStopwatch('habit-1'),
      ).rejects.toThrow(
        'Stopwatch duration must be greater than zero.',
      )

      expect(
        await db.activeTimers.get('habit-1'),
      ).toBeDefined()

      expect(await db.entries.count()).toBe(0)
    })
  })

  describe('cancelStopwatch', () => {
    it('removes an active stopwatch without creating an entry', async () => {
      await db.habits.add(makeHabit('habit-1'))

      await startStopwatch('habit-1')
      await cancelStopwatch('habit-1')

      expect(
        await db.activeTimers.get('habit-1'),
      ).toBeUndefined()

      expect(await db.entries.count()).toBe(0)
    })
  })

  describe('persistence', () => {
    it('preserves an active stopwatch after closing and reopening the database', async () => {
      await db.habits.add(makeHabit('habit-1'))

      const started = await startStopwatch('habit-1')

      db.close()
      await db.open()

      const retrieved = await getActiveStopwatch('habit-1')

      expect(retrieved).toEqual(started)
    })
  })

  describe('single start and stop (no pause)', () => {
    const T0 = Date.parse('2026-11-01T10:00:00.000Z')
    const MINUTE = 60_000

    function setClock(minutesAfterStart: number) {
      vi.setSystemTime(T0 + minutesAfterStart * MINUTE)
    }

    beforeEach(() => {
      // Only the clock is faked; IndexedDB timers keep running normally.
      vi.useFakeTimers({ toFake: ['Date'] })
      setClock(0)
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('starts running from the start time with no earlier periods', async () => {
      await db.habits.add(makeHabit('habit-1'))

      const timer = await startStopwatch('habit-1')

      expect(timer.completedSegments).toEqual([])
      expect(timer.runningSince).toBe('2026-11-01T10:00:00.000Z')
    })

    it('saves one period from start to stop', async () => {
      await db.habits.add(makeHabit('habit-1'))

      await startStopwatch('habit-1')
      setClock(35)

      const entry = (await stopStopwatch('habit-1')) as StopwatchEntry

      expect(entry.value.segments).toEqual([
        { start: '2026-11-01T10:00:00.000Z', end: '2026-11-01T10:35:00.000Z' },
      ])
      expect(activeDurationMs(entry.value.segments)).toBe(35 * MINUTE)
    })

    it('still stops a timer paused with an earlier version, ending at the pause', async () => {
      await db.habits.add(makeHabit('habit-1'))

      // A timer as left by the earlier pause/resume version.
      await db.activeTimers.add({
        habitId: 'habit-1',
        startedAt: '2026-11-01T10:00:00.000Z',
        timezone: 'Europe/Paris',
        comment: null,
        completedSegments: [
          { start: '2026-11-01T10:00:00.000Z', end: '2026-11-01T10:10:00.000Z' },
        ],
        runningSince: null,
        createdAt: '2026-11-01T10:00:00.000Z',
        updatedAt: '2026-11-01T10:10:00.000Z',
      })
      setClock(60)

      const entry = (await stopStopwatch('habit-1')) as StopwatchEntry

      expect(entry.occurredEnd).toBe('2026-11-01T10:10:00.000Z')
      expect(activeDurationMs(entry.value.segments)).toBe(10 * MINUTE)
      expect(await db.activeTimers.get('habit-1')).toBeUndefined()
    })
  })
})
