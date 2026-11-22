import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest'

import { db } from './db'
import {
  createEntries,
  createEntry,
  deleteEntry,
  getEntriesByHabit,
  restoreEntry,
  updateEntry,
} from './entries'
import { createHabit, deleteHabit, setHabitArchived } from './habits'

const START = '2026-11-01T10:00:00.000Z'
const END = '2026-11-01T11:00:00.000Z'

describe('Entry database operations', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(async () => {
    db.close()
    await db.delete()
  })

  it('creates a number entry', async () => {
    const habit = await createHabit({
      name: 'Water intake',
      type: 'number',
      unit: 'ml',
    })

    const entry = await createEntry({
      habitId: habit.id,
      value: 500,
      occurredStart: START,
      comment: 'Morning intake',
    })

    expect(entry.habitId).toBe(habit.id)
    expect(entry.value).toBe(500)
    expect(entry.occurredEnd).toBeNull()
    // Defaults to the device timezone; tests run with TZ=America/New_York.
    expect(entry.timezone).toBe('America/New_York')
    expect(entry.comment).toBe('Morning intake')
    expect(entry.source).toBe('manual')
    expect(entry.deletedAt).toBeNull()

    expect(await db.entries.get(entry.id)).toEqual(entry)
  })

  it('creates a checkbox entry', async () => {
    const habit = await createHabit({
      name: 'Exercise',
      type: 'checkbox',
    })

    const entry = await createEntry({
      habitId: habit.id,
      value: true,
      occurredStart: START,
    })

    expect(entry.value).toBe(true)
  })

  it('creates a label entry with an allowed option', async () => {
    const habit = await createHabit({
      name: 'Mood',
      type: 'label',
      labelOptions: ['Good', 'Neutral', 'Bad'],
    })

    const entry = await createEntry({
      habitId: habit.id,
      value: 'Good',
      occurredStart: START,
    })

    expect(entry.value).toBe('Good')
  })

  it('creates a text entry', async () => {
    const habit = await createHabit({
      name: 'Journal',
      type: 'text',
    })

    const entry = await createEntry({
      habitId: habit.id,
      value: 'A productive day.',
      occurredStart: START,
    })

    expect(entry.value).toBe('A productive day.')
  })

  it('creates a stopwatch entry with start and end times', async () => {
    const habit = await createHabit({
      name: 'Reading time',
      type: 'stopwatch',
    })

    const entry = await createEntry({
      habitId: habit.id,
      value: null,
      occurredStart: START,
      occurredEnd: END,
    })

    // A manual start/end becomes a single active period.
    expect(entry.value).toEqual({ segments: [{ start: START, end: END }] })
    expect(entry.habitType).toBe('stopwatch')
    expect(entry.occurredStart).toBe(START)
    expect(entry.occurredEnd).toBe(END)
  })

  it('rejects a number entry with a non-numeric value', async () => {
    const habit = await createHabit({
      name: 'Water intake',
      type: 'number',
    })

    await expect(
      createEntry({
        habitId: habit.id,
        value: '500',
        occurredStart: START,
      }),
    ).rejects.toThrow(
      'Number habits require a finite numeric value.',
    )
  })

  it('rejects a checkbox entry with a non-boolean value', async () => {
    const habit = await createHabit({
      name: 'Exercise',
      type: 'checkbox',
    })

    await expect(
      createEntry({
        habitId: habit.id,
        value: 1,
        occurredStart: START,
      }),
    ).rejects.toThrow(
      'Checkbox habits require a boolean value.',
    )
  })

  it('rejects a label value not configured for the habit', async () => {
    const habit = await createHabit({
      name: 'Mood',
      type: 'label',
      labelOptions: ['Good', 'Bad'],
    })

    await expect(
      createEntry({
        habitId: habit.id,
        value: 'Neutral',
        occurredStart: START,
      }),
    ).rejects.toThrow(
      'Value must match one of the habit label options.',
    )
  })

  it('rejects a stopwatch entry without an end time', async () => {
    const habit = await createHabit({
      name: 'Reading time',
      type: 'stopwatch',
    })

    await expect(
      createEntry({
        habitId: habit.id,
        value: null,
        occurredStart: START,
      }),
    ).rejects.toThrow(
      'Stopwatch entries require an end timestamp.',
    )
  })

  it('rejects a stopwatch with an end before its start', async () => {
    const habit = await createHabit({
      name: 'Reading time',
      type: 'stopwatch',
    })

    await expect(
      createEntry({
        habitId: habit.id,
        value: null,
        occurredStart: END,
        occurredEnd: START,
      }),
    ).rejects.toThrow(
      'Stopwatch end time must be after start time.',
    )
  })

  it('rejects an invalid timezone', async () => {
    const habit = await createHabit({
      name: 'Exercise',
      type: 'checkbox',
    })

    await expect(
      createEntry({
        habitId: habit.id,
        value: true,
        occurredStart: START,
        timezone: 'Not/A_Timezone',
      }),
    ).rejects.toThrow('Invalid IANA timezone.')
  })

  it('rejects an invalid timestamp', async () => {
    const habit = await createHabit({
      name: 'Exercise',
      type: 'checkbox',
    })

    await expect(
      createEntry({
        habitId: habit.id,
        value: true,
        occurredStart: 'not-a-date',
      }),
    ).rejects.toThrow(
      'Timestamp must be an ISO 8601 date-time with a timezone.',
    )
  })

  it('rejects entries for an archived habit', async () => {
    const habit = await createHabit({
      name: 'Exercise',
      type: 'checkbox',
    })

    await setHabitArchived(habit.id, true)

    await expect(
      createEntry({
        habitId: habit.id,
        value: true,
        occurredStart: START,
      }),
    ).rejects.toThrow(
      'Cannot log entries for an archived habit.',
    )
  })

  it('allows editing an entry of an archived habit', async () => {
    const habit = await createHabit({
      name: 'Water intake',
      type: 'number',
    })

    const entry = await createEntry({
      habitId: habit.id,
      value: 500,
      occurredStart: START,
    })

    await setHabitArchived(habit.id, true)

    const updated = await updateEntry(entry.id, {
      value: 750,
      comment: 'Corrected after archiving',
    })

    expect(updated.value).toBe(750)
    expect(updated.comment).toBe('Corrected after archiving')
  })

  it('still validates edits to an entry of an archived habit', async () => {
    const habit = await createHabit({
      name: 'Water intake',
      type: 'number',
    })

    const entry = await createEntry({
      habitId: habit.id,
      value: 500,
      occurredStart: START,
    })

    await setHabitArchived(habit.id, true)

    await expect(
      updateEntry(entry.id, { value: 'not a number' }),
    ).rejects.toThrow(
      'Number habits require a finite numeric value.',
    )
  })

  it('updates an existing entry', async () => {
    const habit = await createHabit({
      name: 'Water intake',
      type: 'number',
    })

    const entry = await createEntry({
      habitId: habit.id,
      value: 500,
      occurredStart: START,
    })

    const updated = await updateEntry(entry.id, {
      value: 750,
      comment: 'Corrected amount',
    })

    expect(updated.value).toBe(750)
    expect(updated.comment).toBe('Corrected amount')
    expect(updated.id).toBe(entry.id)
    expect(updated.createdAt).toBe(entry.createdAt)
  })

  it('rejects an update with a value incompatible with the habit', async () => {
    const habit = await createHabit({
      name: 'Water intake',
      type: 'number',
    })

    const entry = await createEntry({
      habitId: habit.id,
      value: 500,
      occurredStart: START,
    })

    await expect(
      updateEntry(entry.id, {
        value: true,
      }),
    ).rejects.toThrow(
      'Number habits require a finite numeric value.',
    )
  })

  it('soft-deletes an entry without physically removing it', async () => {
    const habit = await createHabit({
      name: 'Exercise',
      type: 'checkbox',
    })

    const entry = await createEntry({
      habitId: habit.id,
      value: true,
      occurredStart: START,
    })

    await deleteEntry(entry.id)

    expect(await db.entries.get(entry.id)).toMatchObject({
      id: entry.id,
      deletedAt: expect.any(String),
    })

    expect(await getEntriesByHabit(habit.id)).toHaveLength(0)
  })

  it('returns entries newest first', async () => {
    const habit = await createHabit({
      name: 'Water intake',
      type: 'number',
    })

    await createEntry({
      habitId: habit.id,
      value: 100,
      occurredStart: '2026-11-01T08:00:00.000Z',
    })

    await createEntry({
      habitId: habit.id,
      value: 200,
      occurredStart: '2026-11-01T12:00:00.000Z',
    })

    const entries = await getEntriesByHabit(habit.id)

    expect(entries.map((entry) => entry.value)).toEqual([
      200,
      100,
    ])
  })

  it('filters entries using an inclusive start and exclusive end', async () => {
    const habit = await createHabit({
      name: 'Water intake',
      type: 'number',
    })

    await createEntry({
      habitId: habit.id,
      value: 100,
      occurredStart: '2026-11-01T08:00:00.000Z',
    })

    await createEntry({
      habitId: habit.id,
      value: 200,
      occurredStart: '2026-11-01T10:00:00.000Z',
    })

    await createEntry({
      habitId: habit.id,
      value: 300,
      occurredStart: '2026-11-01T12:00:00.000Z',
    })

    const entries = await getEntriesByHabit(habit.id, {
      start: '2026-11-01T10:00:00.000Z',
      end: '2026-11-01T12:00:00.000Z',
    })

    expect(entries.map((entry) => entry.value)).toEqual([200])
  })

  describe('entry type, external ID and sync fields', () => {
    it('stores the habit type, a null external ID and initial sync fields', async () => {
      const habit = await createHabit({ name: 'Water', type: 'number' })

      const entry = await createEntry({
        habitId: habit.id,
        value: 500,
        occurredStart: START,
      })

      expect(entry.habitType).toBe('number')
      expect(entry.externalId).toBeNull()
      expect(entry.syncStatus).toBe('pending')
      expect(entry.revision).toBe(1)
    })

    it('marks every change as pending and increases the revision', async () => {
      const habit = await createHabit({ name: 'Water', type: 'number' })

      const entry = await createEntry({
        habitId: habit.id,
        value: 500,
        occurredStart: START,
      })

      // Simulate a record already confirmed by a future sync engine.
      await db.entries.update(entry.id, { syncStatus: 'synced' })

      const updated = await updateEntry(entry.id, { value: 600 })

      expect(updated.syncStatus).toBe('pending')
      expect(updated.revision).toBe(2)

      await deleteEntry(entry.id)

      const deleted = await db.entries.get(entry.id)

      expect(deleted?.syncStatus).toBe('pending')
      expect(deleted?.revision).toBe(3)
    })
  })

  describe('stopwatch periods', () => {
    const P1 = { start: '2026-11-01T10:00:00.000Z', end: '2026-11-01T10:10:00.000Z' }
    const P2 = { start: '2026-11-01T10:15:00.000Z', end: '2026-11-01T10:35:00.000Z' }

    async function stopwatchHabit() {
      return createHabit({ name: 'Reading', type: 'stopwatch' })
    }

    it('creates an entry from periods and derives its start and end', async () => {
      const habit = await stopwatchHabit()

      const entry = await createEntry({
        habitId: habit.id,
        value: { segments: [P1, P2] },
      })

      expect(entry.occurredStart).toBe(P1.start)
      expect(entry.occurredEnd).toBe(P2.end)
      expect(entry.value).toEqual({ segments: [P1, P2] })
    })

    it('rejects start/end that contradict the periods', async () => {
      const habit = await stopwatchHabit()

      await expect(
        createEntry({
          habitId: habit.id,
          value: { segments: [P1, P2] },
          occurredStart: P1.start,
          occurredEnd: P1.end,
        }),
      ).rejects.toThrow('Stopwatch start and end must match its first and last periods.')
    })

    it('rejects overlapping periods', async () => {
      const habit = await stopwatchHabit()

      await expect(
        createEntry({
          habitId: habit.id,
          value: { segments: [P2, P1] },
        }),
      ).rejects.toThrow('Stopwatch periods must be in time order and must not overlap.')
    })

    it('lets the start and end of an entry without pauses be edited', async () => {
      const habit = await stopwatchHabit()

      const entry = await createEntry({
        habitId: habit.id,
        value: null,
        occurredStart: START,
        occurredEnd: END,
      })

      const updated = await updateEntry(entry.id, {
        occurredEnd: '2026-11-01T11:30:00.000Z',
      })

      expect(updated.value).toEqual({
        segments: [{ start: START, end: '2026-11-01T11:30:00.000Z' }],
      })
      expect(updated.occurredEnd).toBe('2026-11-01T11:30:00.000Z')
    })

    it('requires the periods to be edited when the entry has pauses', async () => {
      const habit = await stopwatchHabit()

      const entry = await createEntry({
        habitId: habit.id,
        value: { segments: [P1, P2] },
      })

      await expect(
        updateEntry(entry.id, { occurredEnd: '2026-11-01T11:00:00.000Z' }),
      ).rejects.toThrow('This stopwatch entry has pauses. Edit its periods instead')

      const updated = await updateEntry(entry.id, {
        value: { segments: [P1] },
      })

      expect(updated.occurredEnd).toBe(P1.end)
    })

    it('keeps the periods when only the comment changes', async () => {
      const habit = await stopwatchHabit()

      const entry = await createEntry({
        habitId: habit.id,
        value: { segments: [P1, P2] },
      })

      const updated = await updateEntry(entry.id, { comment: 'Good session' })

      expect(updated.value).toEqual({ segments: [P1, P2] })
      expect(updated.comment).toBe('Good session')
    })
  })

  describe('restoreEntry (undo delete)', () => {
    it('restores a deleted entry unchanged except for its sync fields', async () => {
      const habit = await createHabit({ name: 'Water', type: 'number' })
      const entry = await createEntry({
        habitId: habit.id,
        value: 500,
        occurredStart: START,
        comment: 'Morning',
      })

      await deleteEntry(entry.id)
      const restored = await restoreEntry(entry.id)

      expect(restored).toMatchObject({
        id: entry.id,
        value: 500,
        occurredStart: START,
        comment: 'Morning',
        createdAt: entry.createdAt,
        deletedAt: null,
        syncStatus: 'pending',
        revision: 3,
      })
      expect(await getEntriesByHabit(habit.id)).toHaveLength(1)
    })

    it('restores an entry of an archived habit', async () => {
      const habit = await createHabit({ name: 'Water', type: 'number' })
      const entry = await createEntry({ habitId: habit.id, value: 1, occurredStart: START })

      await deleteEntry(entry.id)
      await setHabitArchived(habit.id, true)

      expect((await restoreEntry(entry.id)).deletedAt).toBeNull()
    })

    it('refuses to restore an entry whose habit was deleted', async () => {
      const habit = await createHabit({ name: 'Water', type: 'number' })
      const entry = await createEntry({ habitId: habit.id, value: 1, occurredStart: START })

      await deleteEntry(entry.id)
      await deleteHabit(habit.id)

      await expect(restoreEntry(entry.id)).rejects.toThrow('Habit not found.')
      expect((await db.entries.get(entry.id))?.deletedAt).not.toBeNull()
    })

    it('refuses entries that are not deleted or do not exist', async () => {
      const habit = await createHabit({ name: 'Water', type: 'number' })
      const entry = await createEntry({ habitId: habit.id, value: 1, occurredStart: START })

      await expect(restoreEntry(entry.id)).rejects.toThrow('This entry is not deleted.')
      await expect(restoreEntry('missing')).rejects.toThrow('Entry not found.')
    })
  })

  describe('createEntries (several categories at once)', () => {
    it('saves one entry per category, all at the same time', async () => {
      const habit = await createHabit({
        name: 'Feelings',
        type: 'label',
        labelOptions: ['Love', 'Pride', 'Fear'],
      })

      const saved = await createEntries(
        ['Love', 'Pride'].map((value) => ({
          habitId: habit.id,
          value,
          occurredStart: START,
          timezone: 'Europe/Paris',
          comment: 'Same comment',
        })),
      )

      expect(saved.map((entry) => entry.value)).toEqual(['Love', 'Pride'])
      expect(new Set(saved.map((entry) => entry.occurredStart))).toEqual(new Set([START]))
      expect(saved.every((entry) => entry.source === 'manual')).toBe(true)
      expect(await getEntriesByHabit(habit.id)).toHaveLength(2)
    })

    it('saves nothing when one of the entries is invalid', async () => {
      const habit = await createHabit({
        name: 'Feelings',
        type: 'label',
        labelOptions: ['Love', 'Pride'],
      })

      await expect(
        createEntries(
          ['Love', 'Unknown'].map((value) => ({
            habitId: habit.id,
            value,
            occurredStart: START,
          })),
        ),
      ).rejects.toThrow('Value must match one of the habit label options.')

      expect(await db.entries.count()).toBe(0)
    })

    it('refuses an empty list', async () => {
      await expect(createEntries([])).rejects.toThrow('Nothing to save.')
    })
  })
})
