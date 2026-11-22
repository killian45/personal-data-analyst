import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { db } from '../database/db'
import { createEntry, deleteEntry } from '../database/entries'
import { createHabit, deleteHabit, setHabitArchived } from '../database/habits'
import { createManualSleepSession, deleteSleepSession } from '../database/sleepSessions'

import { loadLogRows } from './loadLogRows'

const START = '2026-11-09T08:00:00.000Z'

describe('loadLogRows', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(async () => {
    db.close()
    await db.delete()
  })

  it('includes entries of active and archived habits but not deleted ones', async () => {
    const water = await createHabit({ name: 'Water', type: 'number' })
    const gym = await createHabit({ name: 'Gym', type: 'checkbox' })
    const old = await createHabit({ name: 'Old', type: 'checkbox' })

    const kept = await createEntry({ habitId: water.id, value: 1, occurredStart: START })
    const removed = await createEntry({ habitId: water.id, value: 2, occurredStart: START })
    const archivedEntry = await createEntry({ habitId: gym.id, value: true, occurredStart: START })
    await createEntry({ habitId: old.id, value: true, occurredStart: START })

    await deleteEntry(removed.id)
    await setHabitArchived(gym.id, true)
    await deleteHabit(old.id)

    const { rows, habits } = await loadLogRows()

    expect(rows.map((r) => r.id).sort()).toEqual([kept.id, archivedEntry.id].sort())
    expect(habits.map((h) => h.name)).toEqual(['Gym', 'Water'])

    // Deleted records are still stored (and therefore in backups).
    expect(await db.entries.count()).toBe(4)
  })

  it('returns no rows for an empty database', async () => {
    expect(await loadLogRows()).toEqual({ rows: [], habits: [], entriesById: new Map(), sleepById: new Map(), hasScreenTime: false, hasLocation: false })
  })

  it('includes non-deleted sleep sessions as Sleep rows', async () => {
    const kept = await createManualSleepSession({ startUtc: '2026-11-08T22:30:00Z', endUtc: '2026-11-09T06:15:00Z' })
    const removed = await createManualSleepSession({ startUtc: '2026-11-07T22:30:00Z', endUtc: '2026-11-08T06:15:00Z' })
    await deleteSleepSession(removed.id)

    const { rows, sleepById } = await loadLogRows()

    expect(rows.map((r) => [r.id, r.kind])).toEqual([[kept.id, 'sleep']])
    expect([...sleepById.keys()]).toEqual([kept.id])
  })
})
