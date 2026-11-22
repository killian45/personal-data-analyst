import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { db } from '../database/db'
import type { ExternalSample } from '../database/types'

import { applyHealthImport, grantedKinds, HEALTH_SOURCES, previewHealthImport, readWindowStart } from './healthImport'

// A simulated phone (test timezone: America/New_York, UTC−5 in November).
const phone = vi.hoisted(() => ({
  granted: [] as string[],
  records: {} as Record<string, unknown[]>,
  reads: [] as { type: string; start: string }[],
}))

vi.mock('./healthDataPlugin', () => ({
  grantedHealthPermissions: async () => phone.granted,
  readHealthRecords: async (type: string, start: Date) => {
    phone.reads.push({ type, start: start.toISOString() })
    return phone.records[type] ?? []
  },
}))

const meta = (id: string) => ({ id, dataOrigin: 'com.sec.android.app.shealth', lastModifiedTime: '2026-11-11T20:00:00Z' })
const steps = (id: string, start: string, count: number) => ({ metadata: meta(id), startTime: start, endTime: start, startZoneOffset: '-05:00', count })
const NOW = new Date('2026-11-12T15:00:00Z') // 10:00 on 12 Nov in New York

beforeEach(async () => {
  await db.delete()
  await db.open()
  Object.assign(phone, { granted: [], records: {}, reads: [] })
})

afterEach(async () => {
  db.close()
  await db.delete()
})

describe('grantedKinds and the read window', () => {
  it('lists the kinds whose permission was granted', () => {
    expect(grantedKinds([HEALTH_SOURCES.steps.permission, HEALTH_SOURCES.exercise.permission, 'android.permission.health.READ_SLEEP'])).toEqual(['steps', 'exercise'])
  })

  it('first import: 90 days back; later: the last stored day minus 7 days', () => {
    expect(readWindowStart([], '2026-11-12')).toBe('2026-08-14')
    const stored = [{ metadata: { localDate: '2026-11-05' } }, { metadata: { localDate: '2026-11-11' } }] as unknown as ExternalSample[]
    expect(readWindowStart(stored, '2026-11-12')).toBe('2026-11-04')
  })
})

describe('previewHealthImport + applyHealthImport', () => {
  it('imports finished days, then updates a day that received late data, and changes nothing the third time', async () => {
    phone.granted = [HEALTH_SOURCES.steps.permission]
    phone.records.Steps = [
      steps('a', '2026-11-10T14:00:00Z', 1000),
      steps('b', '2026-11-11T14:00:00Z', 2000),
      steps('t', '2026-11-12T14:00:00Z', 300), // today: not imported
    ]

    const first = await previewHealthImport(NOW)
    expect(first).toMatchObject({ from: '2026-08-14', to: '2026-11-11', kinds: ['steps'], unchanged: 0, toUpdate: [] })
    expect(first.toAdd.map((s) => [s.metadata?.localDate, s.value])).toEqual([['2026-11-10', 1000], ['2026-11-11', 2000]])
    expect(phone.reads).toEqual([{ type: 'Steps', start: '2026-08-13T00:00:00.000Z' }])
    expect(await db.externalSamples.count()).toBe(0) // preview writes nothing
    expect(await applyHealthImport(first)).toBe(2)

    // The watch synced late: more steps on 11 Nov.
    phone.records.Steps = [...phone.records.Steps, steps('c', '2026-11-11T20:00:00Z', 500)]
    const second = await previewHealthImport(NOW)
    expect(second.from).toBe('2026-11-04')
    expect(second.toAdd).toEqual([])
    expect(second.unchanged).toBe(1)
    expect(second.toUpdate.map((s) => [s.metadata?.localDate, s.value, s.revision])).toEqual([['2026-11-11', 2500, 2]])
    await applyHealthImport(second)
    const day = await db.externalSamples.where('dedupeKey').equals('health_connect:steps:com.sec.android.app.shealth:2026-11-11').first()
    expect(day).toMatchObject({ value: 2500, revision: 2, syncStatus: 'pending' })

    const third = await previewHealthImport(NOW)
    expect(third).toMatchObject({ toAdd: [], toUpdate: [], unchanged: 2 })
  })

  it('lists unreadable records instead of dropping them silently', async () => {
    phone.granted = [HEALTH_SOURCES.steps.permission]
    phone.records.Steps = [steps('a', '2026-11-10T14:00:00Z', 1000), { metadata: {}, startTime: 'x', count: 1 }]
    const plan = await previewHealthImport(NOW)
    expect(plan.toAdd).toHaveLength(1)
    expect(plan.notImported).toEqual([{ label: 'Steps record', reason: 'the record has no Health Connect id' }])
  })

  it('saves nothing if a planned day changed meanwhile', async () => {
    phone.granted = [HEALTH_SOURCES.steps.permission]
    phone.records.Steps = [steps('a', '2026-11-10T14:00:00Z', 1000)]
    await applyHealthImport(await previewHealthImport(NOW))
    phone.records.Steps = [steps('a', '2026-11-10T14:00:00Z', 1200)]
    const plan = await previewHealthImport(NOW)
    // Changed by something else before saving (e.g. a sync).
    const stored = await db.externalSamples.toArray()
    await db.externalSamples.put({ ...stored[0], revision: 5 })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(applyHealthImport(plan)).rejects.toThrow('Nothing was saved')
    expect((await db.externalSamples.toArray())[0].value).toBe(1000)
    vi.restoreAllMocks()
  })

  it('reads nothing without permission', async () => {
    const plan = await previewHealthImport(NOW)
    expect(plan).toMatchObject({ kinds: [], toAdd: [] })
    expect(phone.reads).toEqual([])
  })
})
