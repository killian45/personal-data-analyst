import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { db } from '../database/db'
import { createManualSleepSession, deleteSleepSession } from '../database/sleepSessions'
import { processSleep } from '../sleep/engine/processSleep'

import { readHealthConnectSleep, toSleepSession } from './healthConnect'
import { applySleepImport, extractHealthConnectDatabase, planSleepImport, previewHealthConnectImport } from './sleepImport'
import { openSqlite } from './sqlite'
import { buildHealthConnectDb } from './testHealthConnect'
import type { FakeSession } from './testHealthConnect'
import { buildZip } from './testZip'

// Night of 8 Nov: 23:00–07:00 Paris (UTC+1) = 22:00–06:00 UTC.
const NIGHT: FakeSession = {
  start: '2026-11-08T22:00:00.000Z',
  end: '2026-11-09T06:00:00.000Z',
  title: 'Night',
  notes: 'Original note',
  stages: [
    { start: '2026-11-08T22:00:00.000Z', end: '2026-11-08T22:20:00.000Z', type: 1 },
    { start: '2026-11-08T22:20:00.000Z', end: '2026-11-09T02:00:00.000Z', type: 4 },
    { start: '2026-11-09T02:00:00.000Z', end: '2026-11-09T03:00:00.000Z', type: 5 },
    { start: '2026-11-09T03:00:00.000Z', end: '2026-11-09T05:30:00.000Z', type: 6 },
    { start: '2026-11-09T05:30:00.000Z', end: '2026-11-09T06:00:00.000Z', type: 3 },
  ],
}

async function read(sessions: FakeSession[], options = {}) {
  const database = await openSqlite(await buildHealthConnectDb(sessions, options))
  try {
    return readHealthConnectSleep(database)
  } finally {
    database.close()
  }
}

let counter = 0
const ids = () => `id-${++counter}`

describe('reading a Health Connect export', () => {
  it('reads sessions with app, device and linked stages; counts other data without reading it', async () => {
    const data = await read([NIGHT], { otherCounts: { steps_record_table: 3, heart_rate_record_table: 2, weight_record_table: 0 } })

    expect(data.records).toHaveLength(1)
    expect(data.records[0]).toMatchObject({
      uuid: '00000000-0000-4000-8000-000000000001',
      startMs: Date.parse(NIGHT.start),
      startOffsetSeconds: 3600,
      title: 'Night',
      notes: 'Original note',
      packageName: 'com.example.sleep',
      appName: 'Example Sleep',
      deviceManufacturer: 'Example',
      deviceModel: 'Watch 1',
    })
    expect(data.records[0].stages.map((stage) => stage.type)).toEqual([1, 4, 5, 6, 3])
    expect(data.otherData).toEqual([
      { label: 'heart rate', count: 2 },
      { label: 'steps', count: 3 },
    ])
  })

  it('reports files that are not Health Connect exports or have an unexpected format', async () => {
    await expect(read([NIGHT], { omitStagesTable: true })).rejects.toThrow('This does not look like a Health Connect export')
    await expect(read([NIGHT], { omitColumn: 'start_zone_offset' })).rejects.toThrow(
      'unexpected format (missing: start_zone_offset)',
    )
  })
})

describe('converting a record', () => {
  it('maps times, offsets (seconds → minutes) and stage codes, and preserves originals', async () => {
    const [record] = (await read([{ ...NIGHT, endOffsetSeconds: 32400 }])).records
    const session = toSleepSession(record, { id: 'x', importedAt: '2026-11-10T09:00:00.000Z' })

    expect(session).toMatchObject({
      source: 'health_connect',
      externalId: '00000000-0000-4000-8000-000000000001',
      dedupeKey: 'health_connect:id:00000000-0000-4000-8000-000000000001',
      sourceApp: 'com.example.sleep',
      startUtc: '2026-11-08T22:00:00.000Z',
      endUtc: '2026-11-09T06:00:00.000Z',
      timezone: null,
      startOffsetMinutes: 60,
      endOffsetMinutes: 540,
      reportedSleepMs: null,
      comment: null,
      importedAt: '2026-11-10T09:00:00.000Z',
    })
    expect(session.stages.map((stage) => stage.stage)).toEqual(['awake', 'light', 'deep', 'rem', 'out_of_bed'])
    expect(session.metadata?.healthConnect).toMatchObject({
      title: 'Night',
      notes: 'Original note',
      appName: 'Example Sleep',
      deviceModel: 'Watch 1',
      startZoneOffsetSeconds: 3600,
      endZoneOffsetSeconds: 32400,
      lastModifiedTime: '2026-11-09T08:00:00.000Z',
    })
  })

  it('keeps unknown stage codes as "unknown" and records the original codes', async () => {
    const [record] = (await read([{ ...NIGHT, stages: [{ start: NIGHT.start, end: NIGHT.end, type: 42 }] }])).records
    const session = toSleepSession(record, { id: 'x', importedAt: '2026-11-10T09:00:00.000Z' })

    expect(session.stages[0].stage).toBe('unknown')
    expect(session.metadata?.healthConnect).toMatchObject({ unknownStageCodes: [42] })
  })

  it('rejects invalid records with a reason', async () => {
    const records = (await read([
      { ...NIGHT, end: NIGHT.start },
      { ...NIGHT, end: '2026-11-11T06:00:00.000Z' },
      { ...NIGHT, startOffsetSeconds: 3601 },
      { ...NIGHT, startOffsetSeconds: null },
    ])).records

    expect(records.map((record) => {
      try {
        toSleepSession(record, { id: 'x', importedAt: '2026-11-10T09:00:00.000Z' })
        return 'ok'
      } catch (error) {
        return (error as Error).message
      }
    })).toEqual([
      'the session does not end after it starts',
      'a sleep session cannot last more than 48 hours',
      'start UTC offset is not a whole number of minutes',
      'the record has no start UTC offset',
    ])
  })
})

describe('planning and applying an import', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(async () => {
    db.close()
    await db.delete()
  })

  it('imports new sessions, which the sleep engine then uses (with stages)', async () => {
    const zip = await buildZip([{ name: 'health_connect_export.db', content: await buildHealthConnectDb([NIGHT]), deflate: true }], { dataDescriptor: true })

    const plan = await previewHealthConnectImport(zip, 'Health Connect.zip')
    expect(plan).toMatchObject({ found: 1, duplicates: [], needsAttention: [], invalid: [] })
    expect(plan.toAdd).toHaveLength(1)
    expect(await db.sleepSessions.count()).toBe(0)

    expect(await applySleepImport(plan)).toBe(1)

    const { nights } = processSleep(await db.sleepSessions.toArray())
    // Stages: 3 h 40 light + 1 h deep + 2 h 30 REM = 7 h 10
    expect(nights[0]).toMatchObject({ nightDate: '2026-11-08', sleepMs: (7 * 60 + 10) * 60_000, methods: ['stages'], bedtimeHours: 23 })
  })

  it('skips sessions already imported, so importing the same file twice adds nothing', async () => {
    const bytes = await buildHealthConnectDb([NIGHT])

    await applySleepImport(await previewHealthConnectImport(bytes, 'export.db'))
    const second = await previewHealthConnectImport(bytes, 'export.db')

    expect(second.toAdd).toEqual([])
    expect(second.duplicates).toEqual([
      { label: 'Sleep session starting 2026-11-08 22:00 UTC (Example Sleep)', reason: 'already imported' },
    ])
  })

  it('flags sessions changed in Health Connect, or deleted in the app, and keeps the app version', async () => {
    await applySleepImport(await previewHealthConnectImport(await buildHealthConnectDb([NIGHT, { ...NIGHT, start: '2026-11-09T22:00:00.000Z', end: '2026-11-10T06:00:00.000Z' }]), 'a.db'))
    const [first, second] = await db.sleepSessions.orderBy('startUtc').toArray()
    await deleteSleepSession(second.id)

    const plan = await previewHealthConnectImport(
      await buildHealthConnectDb([
        { ...NIGHT, lastModified: '2026-11-10T08:00:00.000Z', end: '2026-11-09T07:00:00.000Z' },
        { ...NIGHT, start: '2026-11-09T22:00:00.000Z', end: '2026-11-10T06:00:00.000Z' },
      ]),
      'b.db',
    )

    expect(plan.toAdd).toEqual([])
    expect(plan.needsAttention.map((item) => item.reason)).toEqual([
      'changed in Health Connect since it was imported; the version already in the app was kept',
      'already imported and later deleted; restore it from Deleted data if you want it back',
    ])
    expect((await db.sleepSessions.get(first.id))?.endUtc).toBe('2026-11-09T06:00:00.000Z')
  })

  it('lists invalid records and duplicates within the file, and notes overlaps with manual sessions', async () => {
    await createManualSleepSession({ startUtc: '2026-11-08T22:30:00Z', endUtc: '2026-11-09T06:30:00Z' })

    const { records, otherData } = await read([
      NIGHT,
      { ...NIGHT, uuid: '00000000000040008000000000000001' },
      { ...NIGHT, uuid: '000000000000400080000000000000ff', end: NIGHT.start },
    ])
    const plan = planSleepImport({ fileName: 'x.db', records, otherData }, await db.sleepSessions.toArray(), { importedAt: '2026-11-10T09:00:00.000Z', newId: ids })

    expect(plan.toAdd).toHaveLength(1)
    expect(plan.duplicates.map((item) => item.reason)).toEqual(['listed twice in the file'])
    expect(plan.invalid.map((item) => item.reason)).toEqual(['the session does not end after it starts'])
    expect(plan.notes).toEqual([
      '1 imported session(s) overlap sessions you logged by hand. Both are kept; the dashboard merges overlapping sessions so the time is counted once.',
    ])
    expect(plan.firstStartUtc).toBe('2026-11-08T22:00:00.000Z')
  })

  it('imports nothing if a session appears meanwhile (all or nothing)', async () => {
    const bytes = await buildHealthConnectDb([NIGHT, { ...NIGHT, start: '2026-11-09T22:00:00.000Z', end: '2026-11-10T06:00:00.000Z' }])
    const plan = await previewHealthConnectImport(bytes, 'a.db')

    // Imported meanwhile in another tab.
    await db.sleepSessions.add(plan.toAdd[1])

    await expect(applySleepImport(plan)).rejects.toThrow('Nothing was imported')
    expect(await db.sleepSessions.count()).toBe(1)
  })

  it('explains zip files without a Health Connect database', async () => {
    const zip = await buildZip([{ name: 'notes.txt', content: new TextEncoder().encode('hello') }])

    await expect(extractHealthConnectDatabase(zip)).rejects.toThrow('No Health Connect database (health_connect_export.db) was found')
  })
})
