import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { db } from '../database/db'
import { deleteExternalSample, restoreExternalSample } from '../database/externalSamples'
import type { ExternalSample } from '../database/types'

import {
  applyScreenTimeImport,
  formatDayMonthYear,
  planScreenTimeImport,
  previewScreenTimeImport,
  screenTimeResultText,
} from './screenTimeImport'
import { appUsageCsv } from './testAppUsage'

const NOW = '2026-11-11T09:00:00.000Z'

function options(today = '2026-11-11', timezone = 'Europe/Paris') {
  let next = 0
  return { importedAt: NOW, newId: () => `st-${(next += 1)}`, timezone, today }
}

/** A made-up file for 1–9 November 2026, exported at 02:01 the next day. */
function fileFor(day: number, changes: Parameters<typeof appUsageCsv>[0] = {}) {
  return {
    fileName: `AUM_V4_Usage_2026-11-${String(day + 1).padStart(2, '0')}.csv`,
    text: appUsageCsv({
      dateLine: `11/${day}/26`,
      title: `Usage history, November ${day}, 2026`,
      created: `Created by App Usage (PRO) on Monday, November ${day + 1}, 2026 at 02:01`,
      ...changes,
    }),
  }
}

describe('planScreenTimeImport', () => {
  it('turns a file into one complete screen-time day (Paris)', () => {
    const plan = planScreenTimeImport([fileFor(9)], [], options())

    expect(plan.found).toBe(1)
    expect(plan.invalid).toEqual([])
    expect(plan.toAdd).toEqual([
      {
        id: 'st-1',
        source: 'import',
        externalId: null,
        sourceApp: 'App Usage',
        dedupeKey: 'screen_time:import:2026-11-09',
        measurementType: 'screen_time_daily',
        value: 4380,
        unit: 's',
        startUtc: '2026-11-08T23:00:00.000Z',
        endUtc: '2026-11-09T23:00:00.000Z',
        timezone: 'Europe/Paris',
        startOffsetMinutes: 60,
        importedAt: NOW,
        metadata: {
          format: 1,
          localDate: '2026-11-09',
          apps: [
            { name: 'Messages', seconds: 3723, opens: 12 },
            { name: 'Maps, offline', seconds: 600, opens: 3 },
            { name: 'Browser', seconds: 57, opens: 1 },
          ],
          fileFormat: 'app_usage_usage_history_csv',
          fileName: 'AUM_V4_Usage_2026-11-10.csv',
          exportCreatedLocal: '2026-11-10T02:01',
        },
        syncStatus: 'pending',
        revision: 1,
        syncedRevision: null,
        createdAt: NOW,
        updatedAt: NOW,
        deletedAt: null,
      },
    ])
    expect(plan.firstDate).toBe('2026-11-09')
    expect(plan.lastDate).toBe('2026-11-09')
  })

  it('reads the day in the chosen timezone', () => {
    const plan = planScreenTimeImport([fileFor(9)], [], options('2026-11-11', 'America/New_York'))
    expect(plan.toAdd[0]).toMatchObject({
      startUtc: '2026-11-09T05:00:00.000Z',
      endUtc: '2026-11-10T05:00:00.000Z',
      timezone: 'America/New_York',
      startOffsetMinutes: -300,
    })
  })

  it('imports several files at once, in any order', () => {
    const plan = planScreenTimeImport([fileFor(7), fileFor(5), fileFor(6)], [], options())
    expect(plan.toAdd.map((sample) => sample.metadata?.localDate)).toEqual(['2026-11-07', '2026-11-05', '2026-11-06'])
    expect([plan.firstDate, plan.lastDate]).toEqual(['2026-11-05', '2026-11-07'])
  })

  it('reports unreadable files by name, with the reason, and keeps the others', () => {
    const plan = planScreenTimeImport(
      [fileFor(8), { fileName: 'notes.csv', text: 'hello,world\n' }, fileFor(9, { title: null })],
      [],
      options(),
    )
    expect(plan.toAdd).toHaveLength(1)
    expect(plan.invalid).toEqual([
      { label: 'notes.csv', reason: expect.stringMatching(/^this is not an App Usage "Usage history" file/) },
      { label: 'AUM_V4_Usage_2026-11-10.csv', reason: expect.stringMatching(/could not be confirmed/) },
    ])
  })

  it('never imports an unfinished day', () => {
    // The day is today (or later) in the chosen timezone.
    const today = planScreenTimeImport([fileFor(9)], [], options('2026-11-09'))
    expect(today.invalid[0].reason).toBe('this day has not ended yet; import it tomorrow')

    // Exported at 23:30 on the same day.
    const early = fileFor(9, { created: 'Created by App Usage (PRO) on Monday, November 9, 2026 at 23:30' })
    expect(planScreenTimeImport([early], [], options()).invalid[0].reason).toBe(
      'the file was exported at 23:30 on that same day, before the day ended; export it again after midnight',
    )

    // Exported exactly at midnight: the day is complete.
    const midnight = fileFor(9, { created: 'Created by App Usage (PRO) on Tuesday, November 10, 2026 at 00:00' })
    expect(planScreenTimeImport([midnight], [], options()).toAdd).toHaveLength(1)
  })

  it('rejects a total longer than the day (23-hour spring day in Paris)', () => {
    const spring = {
      fileName: 'spring.csv',
      text: appUsageCsv({
        apps: [['Video', '23:00:01', '1']],
        total: '23:00:01',
        dateLine: '3/29/26',
        title: 'Usage history, March 29, 2026',
        created: 'Created by App Usage (PRO) on Monday, March 30, 2026 at 02:00',
      }),
    }
    expect(planScreenTimeImport([spring], [], options()).invalid[0].reason).toBe('the total usage time is longer than the day itself')

    const exact = { ...spring, text: spring.text.replace(/23:00:01/g, '23:00:00') }
    expect(planScreenTimeImport([exact], [], options()).toAdd[0].value).toBe(23 * 3600)
  })

  it('notes days whose per-app times do not add up to the total', () => {
    const plan = planScreenTimeImport([fileFor(9, { total: '2:00:00' }), fileFor(8)], [], options())
    expect(plan.toAdd[0].value).toBe(7200)
    expect(plan.notes).toEqual([expect.stringMatching(/^1 day\(s\): the per-app times do not add up/)])
  })

  describe('duplicates', () => {
    function stored(changes: Partial<ExternalSample> = {}): ExternalSample {
      return { ...planScreenTimeImport([fileFor(9)], [], options()).toAdd[0], id: 'old', ...changes }
    }

    it('skips a day already imported with the same figures', () => {
      const plan = planScreenTimeImport([fileFor(9)], [stored()], options())
      expect(plan.toAdd).toEqual([])
      expect(plan.duplicates).toEqual([{ label: 'Screen time 09/11/2026 (AUM_V4_Usage_2026-11-10.csv)', reason: 'already imported' }])
    })

    it('a different file name or import time is still the same day', () => {
      const plan = planScreenTimeImport([{ ...fileFor(9), fileName: 'copy.csv' }], [stored({ importedAt: '2026-11-10T08:00:00.000Z' })], options())
      expect(plan.duplicates).toHaveLength(1)
    })

    it('keeps the stored day when the figures differ, and says so', () => {
      const plan = planScreenTimeImport([fileFor(9, { total: '1:13:05' })], [stored()], options())
      expect(plan.toAdd).toEqual([])
      expect(plan.needsAttention[0].reason).toBe('already in the app with different figures; the version already in the app was kept')
    })

    it('points to Deleted data for a day that was deleted', () => {
      const plan = planScreenTimeImport([fileFor(9)], [stored({ deletedAt: NOW })], options())
      expect(plan.needsAttention[0].reason).toMatch(/restore it from Deleted data/)
    })

    it('handles the same day chosen twice (identical or different)', () => {
      const twice = planScreenTimeImport([fileFor(9), { ...fileFor(9), fileName: 'again.csv' }], [], options())
      expect(twice.toAdd).toHaveLength(1)
      expect(twice.duplicates[0].reason).toBe('the same day was chosen twice')

      const different = planScreenTimeImport([fileFor(9), fileFor(9, { total: '1:13:05' })], [], options())
      expect(different.toAdd).toHaveLength(1)
      expect(different.toAdd[0].value).toBe(4380)
      expect(different.needsAttention[0].reason).toMatch(/only the first one is used/)
    })
  })

  it('formats dates as dd/mm/yyyy and summarises the result', () => {
    expect(formatDayMonthYear('2026-01-05')).toBe('05/01/2026')
    const plan = planScreenTimeImport([fileFor(9), fileFor(9), { fileName: 'x.csv', text: '' }], [], options())
    expect(screenTimeResultText(plan, 1)).toBe('Imported screen time for 1 day. 1 skipped as duplicates. 1 file(s) invalid and not imported.')
  })
})

describe('preview and import (database)', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(async () => {
    db.close()
    await db.delete()
  })

  it('writes nothing on preview, adds every day on import, and a second import finds only duplicates', async () => {
    const files = [fileFor(8), fileFor(9)]
    const plan = await previewScreenTimeImport(files, 'Europe/Paris')
    expect(await db.externalSamples.count()).toBe(0)

    expect(await applyScreenTimeImport(plan)).toBe(2)
    expect(await db.externalSamples.count()).toBe(2)

    const again = await previewScreenTimeImport(files, 'Europe/Paris')
    expect(again.toAdd).toEqual([])
    expect(again.duplicates).toHaveLength(2)
  })

  it('imports nothing at all if one day was added meanwhile (no partial import)', async () => {
    const plan = await previewScreenTimeImport([fileFor(8), fileFor(9)], 'Europe/Paris')
    const meanwhile = await previewScreenTimeImport([fileFor(9)], 'Europe/Paris')
    await applyScreenTimeImport(meanwhile)

    await expect(applyScreenTimeImport(plan)).rejects.toThrow(/Nothing was imported/)
    expect((await db.externalSamples.toArray()).map((sample) => sample.metadata?.localDate)).toEqual(['2026-11-09'])
  })

  it('deleted days stay stored, can be restored, and are not imported again', async () => {
    await applyScreenTimeImport(await previewScreenTimeImport([fileFor(9)], 'Europe/Paris'))
    const [day] = await db.externalSamples.toArray()

    await deleteExternalSample(day.id)
    const deleted = await db.externalSamples.get(day.id)
    expect(deleted).toMatchObject({ deletedAt: expect.any(String), revision: 2, syncStatus: 'pending' })
    expect((await previewScreenTimeImport([fileFor(9)], 'Europe/Paris')).needsAttention).toHaveLength(1)
    await expect(deleteExternalSample(day.id)).rejects.toThrow(/not found/)

    const restored = await restoreExternalSample(day.id)
    expect(restored).toMatchObject({ deletedAt: null, revision: 3, value: day.value, metadata: day.metadata })
    await expect(restoreExternalSample(day.id)).rejects.toThrow(/not deleted/)
  })
})
