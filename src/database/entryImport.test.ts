import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { db } from './db'
import { createEntry, importEntries, undoImport } from './entries'
import { createHabit, setHabitArchived } from './habits'

describe('importEntries (spreadsheet import)', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })
  afterEach(async () => {
    db.close()
    await db.delete()
  })

  it('saves stopwatch and number entries as "import", skips entries already present, and undoes the batch', async () => {
    const walk = await createHabit({ name: 'Walk', type: 'stopwatch' })
    const result = await importEntries(walk.id, [
      { row: 2, value: null, occurredStart: '2026-11-13T22:30:00.000Z', occurredEnd: '2026-11-13T23:45:00.000Z', comment: 'late' },
      { row: 3, value: null, occurredStart: '2026-11-14T07:00:00.000Z', occurredEnd: '2026-11-14T07:30:00.000Z', comment: null },
    ], 'Europe/Paris', 'b1')
    expect(result.skipped).toBe(0)
    expect(result.added.map((e) => [e.source, e.externalId, e.timezone, e.occurredEnd, e.comment])).toEqual([
      ['import', 'sheet:b1:2', 'Europe/Paris', '2026-11-13T23:45:00.000Z', 'late'],
      ['import', 'sheet:b1:3', 'Europe/Paris', '2026-11-14T07:30:00.000Z', null],
    ])
    expect(result.added[0].value).toEqual({ segments: [{ start: '2026-11-13T22:30:00.000Z', end: '2026-11-13T23:45:00.000Z' }] })

    // Importing the same file again adds nothing.
    const again = await importEntries(walk.id, [{ row: 2, value: null, occurredStart: '2026-11-13T22:30:00.000Z', occurredEnd: '2026-11-13T23:45:00.000Z', comment: null }], 'Europe/Paris', 'b2')
    expect(again).toMatchObject({ added: [], skipped: 1 })

    // A manual entry with the same time and value is also a duplicate.
    const dose = await createHabit({ name: 'Dose', type: 'number', unit: 'mg' })
    await createEntry({ habitId: dose.id, value: 5, occurredStart: '2026-11-13T07:00:00.000Z', timezone: 'Europe/Paris' })
    const doses = await importEntries(dose.id, [
      { row: 2, value: 5, occurredStart: '2026-11-13T07:00:00.000Z', occurredEnd: null, comment: null },
      { row: 3, value: 2.5, occurredStart: '2026-11-13T19:00:00.000Z', occurredEnd: null, comment: null },
    ], 'Europe/Paris', 'b3')
    expect(doses.added.map((e) => e.value)).toEqual([2.5])
    expect(doses.skipped).toBe(1)

    expect(await undoImport('b1')).toBe(2)
    const live = (await db.entries.where('habitId').equals(walk.id).toArray()).filter((e) => e.deletedAt === null)
    expect(live).toHaveLength(0)
    expect(await undoImport('b1')).toBe(0)
  })

  it('several categories from one cell: one entry each, numbered in externalId', async () => {
    const feelings = await createHabit({ name: 'Feelings', type: 'label', labelOptions: ['Love', 'Pride'] })
    const result = await importEntries(feelings.id, [
      { row: 2, part: 1, value: 'Love', occurredStart: '2026-11-13T07:00:00.000Z', occurredEnd: null, comment: null },
      { row: 2, part: 2, value: 'Pride', occurredStart: '2026-11-13T07:00:00.000Z', occurredEnd: null, comment: null },
    ], 'Europe/Paris', 'b6')
    expect(result.added.map((e) => [e.value, e.externalId])).toEqual([['Love', 'sheet:b6:2.1'], ['Pride', 'sheet:b6:2.2']])
    expect(await undoImport('b6')).toBe(2)
  })

  it('saves nothing when one entry is invalid (all or nothing), and refuses archived habits', async () => {
    const mood = await createHabit({ name: 'Mood', type: 'label', labelOptions: ['Calm', 'Tense'] })
    await expect(importEntries(mood.id, [
      { row: 2, value: 'Calm', occurredStart: '2026-11-13T07:00:00.000Z', occurredEnd: null, comment: null },
      { row: 3, value: 'Angry', occurredStart: '2026-11-13T08:00:00.000Z', occurredEnd: null, comment: null },
    ], 'Europe/Paris', 'b4')).rejects.toThrow()
    expect(await db.entries.count()).toBe(0)

    await setHabitArchived(mood.id, true)
    await expect(importEntries(mood.id, [{ row: 2, value: 'Calm', occurredStart: '2026-11-13T07:00:00.000Z', occurredEnd: null, comment: null }], 'Europe/Paris', 'b5'))
      .rejects.toThrow('archived')
  })
})
