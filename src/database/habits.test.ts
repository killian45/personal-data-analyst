
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest'

import { db } from './db'
import {
  createHabit,
  deleteHabit,
  getActiveHabits,
  getAllHabits,
  reorderHabits,
  restoreHabit,
  setHabitArchived,
  updateHabit,
} from './habits'
import { createEntry, deleteEntry } from './entries'
import { startStopwatch } from './stopwatches'

const START = '2026-11-01T10:00:00.000Z'

describe('Habit database operations', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(async () => {
    db.close()
    await db.delete()
  })

  it('creates a habit with default values', async () => {
    const habit = await createHabit({
      name: 'Water intake',
      type: 'number',
    })

    expect(habit.id).toBeTruthy()
    expect(habit.name).toBe('Water intake')
    expect(habit.type).toBe('number')
    expect(habit.unit).toBeNull()
    expect(habit.color).toBe('#2563eb')
    expect(habit.archived).toBe(false)
    expect(habit.deletedAt).toBeNull()
    expect(habit.sortOrder).toBe(0)

    const storedHabit = await db.habits.get(habit.id)

    expect(storedHabit).toEqual(habit)
  })

  it('trims habit names and units', async () => {
    const habit = await createHabit({
      name: '  Water intake  ',
      type: 'number',
      unit: ' ml ',
    })

    expect(habit.name).toBe('Water intake')
    expect(habit.unit).toBe('ml')
  })

  it('creates label habits with valid options', async () => {
    const habit = await createHabit({
      name: 'Mood',
      type: 'label',
      labelOptions: ['Good', 'Neutral', 'Bad'],
    })

    expect(habit.labelOptions).toEqual([
      'Good',
      'Neutral',
      'Bad',
    ])
  })

  it('rejects an empty habit name', async () => {
    await expect(
      createHabit({
        name: '   ',
        type: 'checkbox',
      }),
    ).rejects.toThrow('Habit name cannot be empty.')
  })

  it('rejects label habits without options', async () => {
    await expect(
      createHabit({
        name: 'Mood',
        type: 'label',
      }),
    ).rejects.toThrow(
      'Label habits must have at least one label option.',
    )
  })

  it('rejects duplicate label options', async () => {
    await expect(
      createHabit({
        name: 'Mood',
        type: 'label',
        labelOptions: ['Good', 'good'],
      }),
    ).rejects.toThrow('Label options must be unique.')
  })

  it('rejects invalid colors', async () => {
    await expect(
      createHabit({
        name: 'Exercise',
        type: 'checkbox',
        color: 'blue',
      }),
    ).rejects.toThrow(
      'Color must be a valid six-digit hexadecimal color.',
    )
  })

  it('updates a habit', async () => {
    const habit = await createHabit({
      name: 'Water',
      type: 'number',
      unit: 'ml',
    })

    const updatedHabit = await updateHabit(habit.id, {
      name: 'Daily water intake',
      unit: 'litres',
    })

    expect(updatedHabit.name).toBe('Daily water intake')
    expect(updatedHabit.unit).toBe('litres')
    expect(updatedHabit.id).toBe(habit.id)
    expect(updatedHabit.createdAt).toBe(habit.createdAt)
  })

  it('requires options when changing a habit to label type', async () => {
    const habit = await createHabit({
      name: 'Mood',
      type: 'text',
    })

    await expect(
      updateHabit(habit.id, {
        type: 'label',
      }),
    ).rejects.toThrow(
      'Label habits must have at least one label option.',
    )
  })

  it('archives and restores a habit', async () => {
    const habit = await createHabit({
      name: 'Exercise',
      type: 'checkbox',
    })

    await setHabitArchived(habit.id, true)

    expect(await getActiveHabits()).toHaveLength(0)
    expect(await getAllHabits()).toHaveLength(1)

    await setHabitArchived(habit.id, false)

    expect(await getActiveHabits()).toHaveLength(1)
  })

  it('soft-deletes a habit without physically removing it', async () => {
    const habit = await createHabit({
      name: 'Reading',
      type: 'checkbox',
    })

    await deleteHabit(habit.id)

    expect(await db.habits.get(habit.id)).toMatchObject({
      id: habit.id,
      deletedAt: expect.any(String),
    })

    expect(await getAllHabits()).toHaveLength(0)
  })

  it('does not update a deleted habit', async () => {
    const habit = await createHabit({
      name: 'Reading',
      type: 'checkbox',
    })

    await deleteHabit(habit.id)

    await expect(
      updateHabit(habit.id, {
        name: 'Updated reading',
      }),
    ).rejects.toThrow('Habit not found.')
  })

  it('assigns new habits consecutive sort orders', async () => {
    const first = await createHabit({
      name: 'Water',
      type: 'number',
    })
    const second = await createHabit({
      name: 'Exercise',
      type: 'checkbox',
    })

    expect(first.sortOrder).toBe(0)
    expect(second.sortOrder).toBe(1)
  })

  it('returns habits in custom order rather than alphabetical order', async () => {
    const first = await createHabit({
      name: 'Zebra',
      type: 'checkbox',
    })
    const second = await createHabit({
      name: 'Apple',
      type: 'checkbox',
    })

    const habits = await getActiveHabits()

    expect(habits.map((habit) => habit.id)).toEqual([
      first.id,
      second.id,
    ])
  })

  it('restores an archived habit at the end of the active order', async () => {
    const first = await createHabit({
      name: 'First',
      type: 'checkbox',
    })
    const second = await createHabit({
      name: 'Second',
      type: 'checkbox',
    })

    await setHabitArchived(first.id, true)
    await setHabitArchived(first.id, false)

    const habits = await getActiveHabits()

    expect(habits.map((habit) => habit.id)).toEqual([
      second.id,
      first.id,
    ])
  })

  it('reorders active habits and persists the new order', async () => {
    const first = await createHabit({
      name: 'First',
      type: 'checkbox',
    })
    const second = await createHabit({
      name: 'Second',
      type: 'checkbox',
    })
    const third = await createHabit({
      name: 'Third',
      type: 'checkbox',
    })

    await reorderHabits([
      third.id,
      first.id,
      second.id,
    ])

    const habits = await getActiveHabits()

    expect(habits.map((habit) => habit.id)).toEqual([
      third.id,
      first.id,
      second.id,
    ])

    const storedThird = await db.habits.get(third.id)
    expect(storedThird?.sortOrder).toBe(0)
  })

  it('rejects an incomplete habit order', async () => {
    const first = await createHabit({
      name: 'First',
      type: 'checkbox',
    })
    await createHabit({
      name: 'Second',
      type: 'checkbox',
    })

    await expect(
      reorderHabits([first.id]),
    ).rejects.toThrow(
      'The new order must contain every active habit exactly once.',
    )
  })

  it('rejects duplicate habit IDs in a new order', async () => {
    const habit = await createHabit({
      name: 'First',
      type: 'checkbox',
    })

    await expect(
      reorderHabits([habit.id, habit.id]),
    ).rejects.toThrow(
      'Habit order cannot contain duplicate IDs.',
    )
  })

  it('does not allow archived habits in a new order', async () => {
    const first = await createHabit({
      name: 'First',
      type: 'checkbox',
    })
    const second = await createHabit({
      name: 'Second',
      type: 'checkbox',
    })

    await setHabitArchived(second.id, true)

    await expect(
      reorderHabits([first.id, second.id]),
    ).rejects.toThrow(
      'The new order must contain every active habit exactly once.',
    )
  })

  it('clears the unit when a habit without entries changes from number to another type', async () => {
    const habit = await createHabit({
      name: 'Water',
      type: 'number',
      unit: 'ml',
    })

    const updated = await updateHabit(habit.id, { type: 'checkbox' })

    expect(updated.unit).toBeNull()
  })

  describe('protecting existing data when editing a habit', () => {
    it('allows changing the type of a habit without entries', async () => {
      const habit = await createHabit({
        name: 'Mood',
        type: 'number',
      })

      const updated = await updateHabit(habit.id, {
        type: 'label',
        labelOptions: ['Good', 'Bad'],
      })

      expect(updated.type).toBe('label')
    })

    it('rejects changing the type of a habit with entries', async () => {
      const habit = await createHabit({
        name: 'Water intake',
        type: 'number',
      })

      await createEntry({
        habitId: habit.id,
        value: 500,
        occurredStart: START,
      })

      await expect(
        updateHabit(habit.id, { type: 'checkbox' }),
      ).rejects.toThrow(
        'Cannot change the type of a habit that already has entries.',
      )

      expect((await db.habits.get(habit.id))?.type).toBe('number')
    })

    it('counts soft-deleted entries when protecting the type', async () => {
      const habit = await createHabit({
        name: 'Water intake',
        type: 'number',
      })

      const entry = await createEntry({
        habitId: habit.id,
        value: 500,
        occurredStart: START,
      })

      await deleteEntry(entry.id)

      await expect(
        updateHabit(habit.id, { type: 'checkbox' }),
      ).rejects.toThrow(
        'Cannot change the type of a habit that already has entries.',
      )
    })

    it('rejects changing the type while a stopwatch is running', async () => {
      const habit = await createHabit({
        name: 'Reading',
        type: 'stopwatch',
      })

      await startStopwatch(habit.id)

      await expect(
        updateHabit(habit.id, { type: 'number' }),
      ).rejects.toThrow(
        'Stop or cancel this stopwatch before changing the habit type.',
      )
    })

    it('allows other changes to a habit with entries', async () => {
      const habit = await createHabit({
        name: 'Water intake',
        type: 'number',
      })

      await createEntry({
        habitId: habit.id,
        value: 500,
        occurredStart: START,
      })

      const updated = await updateHabit(habit.id, {
        name: 'Water',
        type: 'number',
        color: '#16a34a',
      })

      expect(updated.name).toBe('Water')
      expect(updated.color).toBe('#16a34a')
    })

    it('allows adding label options to a habit with entries', async () => {
      const habit = await createHabit({
        name: 'Mood',
        type: 'label',
        labelOptions: ['Good', 'Bad'],
      })

      await createEntry({
        habitId: habit.id,
        value: 'Good',
        occurredStart: START,
      })

      const updated = await updateHabit(habit.id, {
        labelOptions: ['Good', 'Bad', 'Neutral'],
      })

      expect(updated.labelOptions).toEqual(['Good', 'Bad', 'Neutral'])
    })

    it('allows removing label options that are not used', async () => {
      const habit = await createHabit({
        name: 'Mood',
        type: 'label',
        labelOptions: ['Good', 'Bad'],
      })

      await createEntry({
        habitId: habit.id,
        value: 'Good',
        occurredStart: START,
      })

      const updated = await updateHabit(habit.id, {
        labelOptions: ['Good'],
      })

      expect(updated.labelOptions).toEqual(['Good'])
    })

    it('rejects removing a label option used by an entry', async () => {
      const habit = await createHabit({
        name: 'Mood',
        type: 'label',
        labelOptions: ['Good', 'Bad'],
      })

      await createEntry({
        habitId: habit.id,
        value: 'Bad',
        occurredStart: START,
      })

      await expect(
        updateHabit(habit.id, { labelOptions: ['Good'] }),
      ).rejects.toThrow(
        'Cannot remove or rename label options used by existing entries: Bad.',
      )

      expect((await db.habits.get(habit.id))?.labelOptions).toEqual([
        'Good',
        'Bad',
      ])
    })

    it('treats renaming a used label option as a removal', async () => {
      const habit = await createHabit({
        name: 'Mood',
        type: 'label',
        labelOptions: ['Good', 'Bad'],
      })

      await createEntry({
        habitId: habit.id,
        value: 'Good',
        occurredStart: START,
      })

      await expect(
        updateHabit(habit.id, { labelOptions: ['good', 'Bad'] }),
      ).rejects.toThrow(
        'Cannot remove or rename label options used by existing entries: Good.',
      )
    })
  })

  describe('protecting running stopwatches', () => {
    it('rejects archiving a habit with a running stopwatch', async () => {
      const habit = await createHabit({
        name: 'Reading',
        type: 'stopwatch',
      })

      await startStopwatch(habit.id)

      await expect(
        setHabitArchived(habit.id, true),
      ).rejects.toThrow(
        'Stop or cancel this stopwatch before archiving the habit.',
      )

      expect((await db.habits.get(habit.id))?.archived).toBe(false)
    })

    it('rejects deleting a habit with a running stopwatch', async () => {
      const habit = await createHabit({
        name: 'Reading',
        type: 'stopwatch',
      })

      await startStopwatch(habit.id)

      await expect(deleteHabit(habit.id)).rejects.toThrow(
        'Stop or cancel this stopwatch before deleting the habit.',
      )

      expect((await db.habits.get(habit.id))?.deletedAt).toBeNull()
    })
  })

  describe('sync fields', () => {
    it('creates habits as pending with revision 1', async () => {
      const habit = await createHabit({ name: 'Water', type: 'number' })

      expect(habit.syncStatus).toBe('pending')
      expect(habit.revision).toBe(1)
    })

    it('increases the revision on update, archive, restore and delete', async () => {
      const habit = await createHabit({ name: 'Water', type: 'number' })

      await db.habits.update(habit.id, { syncStatus: 'synced' })

      expect((await updateHabit(habit.id, { name: 'Water intake' })).revision).toBe(2)
      expect((await setHabitArchived(habit.id, true)).revision).toBe(3)
      expect((await setHabitArchived(habit.id, false)).revision).toBe(4)

      await deleteHabit(habit.id)

      const stored = await db.habits.get(habit.id)

      expect(stored?.revision).toBe(5)
      expect(stored?.syncStatus).toBe('pending')
    })

    it('increases the revision of reordered habits', async () => {
      const first = await createHabit({ name: 'First', type: 'checkbox' })
      const second = await createHabit({ name: 'Second', type: 'checkbox' })

      await reorderHabits([second.id, first.id])

      expect((await db.habits.get(first.id))?.revision).toBe(2)
      expect((await db.habits.get(second.id))?.revision).toBe(2)
    })
  })

  describe('restoreHabit', () => {
    it('restores a deleted habit at the end of the order, with its entries', async () => {
      const first = await createHabit({ name: 'First', type: 'number' })
      const second = await createHabit({ name: 'Second', type: 'number' })
      await createEntry({ habitId: first.id, value: 1, occurredStart: START })

      await deleteHabit(first.id)
      const restored = await restoreHabit(first.id)

      expect(restored.deletedAt).toBeNull()
      expect(restored.syncStatus).toBe('pending')
      expect(restored.revision).toBe(3)
      expect((await getActiveHabits()).map((h) => h.id)).toEqual([second.id, first.id])
      expect(await db.entries.where('habitId').equals(first.id).count()).toBe(1)
    })

    it('restores an archived habit as archived', async () => {
      const habit = await createHabit({ name: 'Old', type: 'checkbox' })
      await setHabitArchived(habit.id, true)
      await deleteHabit(habit.id)

      const restored = await restoreHabit(habit.id)

      expect(restored.archived).toBe(true)
      expect(restored.deletedAt).toBeNull()
    })

    it('refuses habits that are not deleted or do not exist', async () => {
      const habit = await createHabit({ name: 'Water', type: 'number' })

      await expect(restoreHabit(habit.id)).rejects.toThrow('This habit is not deleted.')
      await expect(restoreHabit('missing')).rejects.toThrow('Habit not found.')
    })
  })

  describe('daily value and target (number habits)', () => {
    it('defaults to a daily total without target', async () => {
      const habit = await createHabit({ name: 'Water', type: 'number', unit: 'ml' })

      expect(habit).toMatchObject({ dailyAggregation: 'sum', target: null })
    })

    it('stores and updates a daily average and a target', async () => {
      const habit = await createHabit({ name: 'Weight', type: 'number', dailyAggregation: 'mean', target: 72 })

      expect(habit).toMatchObject({ dailyAggregation: 'mean', target: 72 })

      // Other changes keep them.
      expect(await updateHabit(habit.id, { name: 'Body weight' })).toMatchObject({ dailyAggregation: 'mean', target: 72 })

      expect(await updateHabit(habit.id, { dailyAggregation: 'sum', target: null })).toMatchObject({
        dailyAggregation: 'sum',
        target: null,
      })
    })

    it('allows changing the daily value of a habit with entries', async () => {
      const habit = await createHabit({ name: 'Water', type: 'number' })
      await createEntry({ habitId: habit.id, value: 1, occurredStart: START })

      await expect(updateHabit(habit.id, { dailyAggregation: 'mean' })).resolves.toMatchObject({
        dailyAggregation: 'mean',
      })
    })
  })
})
