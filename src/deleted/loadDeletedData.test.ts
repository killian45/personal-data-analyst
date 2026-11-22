import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { db } from '../database/db'
import { createEntry, deleteEntry } from '../database/entries'
import { createHabit, deleteHabit } from '../database/habits'

import { loadDeletedData } from './loadDeletedData'

const START = '2026-11-09T08:00:00.000Z'

describe('loadDeletedData', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.parse('2026-11-09T12:00:00.000Z'))
  })

  afterEach(async () => {
    vi.useRealTimers()
    db.close()
    await db.delete()
  })

  it('is empty when nothing is deleted', async () => {
    await createHabit({ name: 'Water', type: 'number' })

    expect(await loadDeletedData()).toEqual({ habits: [], entries: [], sleep: [], screenTime: [], location: [], contacts: [], contactInteractions: [] })
  })

  it('lists deleted habits with the entries that will reappear, newest first', async () => {
    const water = await createHabit({ name: 'Water', type: 'number' })
    const gym = await createHabit({ name: 'Gym', type: 'checkbox' })
    await createEntry({ habitId: water.id, value: 1, occurredStart: START })
    await createEntry({ habitId: water.id, value: 2, occurredStart: START })
    const removed = await createEntry({ habitId: water.id, value: 3, occurredStart: START })
    await deleteEntry(removed.id)

    vi.setSystemTime(Date.parse('2026-11-09T12:01:00.000Z'))
    await deleteHabit(water.id)
    vi.setSystemTime(Date.parse('2026-11-09T12:02:00.000Z'))
    await deleteHabit(gym.id)

    const { habits } = await loadDeletedData()

    expect(habits.map((item) => [item.habit.name, item.entryCount])).toEqual([
      ['Gym', 0],
      ['Water', 2],
    ])
  })

  it('lists deleted entries and says when their habit is deleted too', async () => {
    const water = await createHabit({ name: 'Water', type: 'number' })
    const gym = await createHabit({ name: 'Gym', type: 'checkbox' })
    const first = await createEntry({ habitId: water.id, value: 1, occurredStart: START })
    const second = await createEntry({ habitId: gym.id, value: true, occurredStart: START })

    await deleteEntry(first.id)
    vi.setSystemTime(Date.parse('2026-11-09T12:05:00.000Z'))
    await deleteEntry(second.id)
    await deleteHabit(gym.id)

    const { entries } = await loadDeletedData()

    expect(entries.map((item) => [item.row.id, item.habitDeleted])).toEqual([
      [second.id, true],
      [first.id, false],
    ])
    expect(entries[1]).toMatchObject({
      deletedAt: '2026-11-09T12:00:00.000Z',
      row: { habitName: 'Water', valueLabel: '1' },
    })
  })
})
