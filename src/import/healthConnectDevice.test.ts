import { describe, expect, it } from 'vitest'

import { readHealthConnectSleep, toSleepSession } from './healthConnect'
import { fromPluginSleepRecord, parseZoneOffsetSeconds, type PluginSleepRecord } from './healthConnectDevice'
import { openSqlite } from './sqlite'
import { buildHealthConnectDb } from './testHealthConnect'

const UUID = '0a1b2c3d-4e5f-4061-8293-a4b5c6d7e8f9'

/** The same night as the plugin would deliver it (times as UTC text). */
function pluginNight(overrides: Partial<PluginSleepRecord> = {}): PluginSleepRecord {
  return {
    metadata: {
      id: UUID,
      clientRecordId: null,
      clientRecordVersion: 0,
      lastModifiedTime: '2026-11-09T08:00:00Z',
      dataOrigin: 'com.example.sleep',
    },
    startTime: '2026-11-08T22:30:00Z',
    startZoneOffset: '+01:00',
    endTime: '2026-11-09T06:15:00Z',
    endZoneOffset: '+01:00',
    title: null,
    notes: null,
    stages: [
      { startTime: '2026-11-08T22:40:00Z', endTime: '2026-11-08T23:30:00Z', stage: 4 },
      { startTime: '2026-11-08T23:30:00Z', endTime: '2026-11-09T01:00:00Z', stage: 5 },
    ],
    ...overrides,
  }
}

describe('parseZoneOffsetSeconds', () => {
  it('reads java.time.ZoneOffset ids', () => {
    expect(parseZoneOffsetSeconds('Z')).toBe(0)
    expect(parseZoneOffsetSeconds('+01:00')).toBe(3600)
    expect(parseZoneOffsetSeconds('-05:30')).toBe(-19800)
    expect(parseZoneOffsetSeconds('+05:45:00')).toBe(20700)
    expect(parseZoneOffsetSeconds(null)).toBeNull()
    expect(parseZoneOffsetSeconds(undefined)).toBeNull()
  })

  it('refuses malformed offsets', () => {
    expect(() => parseZoneOffsetSeconds('1:00')).toThrow('invalid UTC offset')
    expect(() => parseZoneOffsetSeconds(3600)).toThrow('invalid UTC offset')
  })
})

describe('fromPluginSleepRecord', () => {
  it('gives the same record as the Health Connect FILE import for the same night', async () => {
    const database = await openSqlite(
      await buildHealthConnectDb([
        {
          uuid: UUID.replace(/-/g, ''),
          start: '2026-11-08T22:30:00.000Z',
          end: '2026-11-09T06:15:00.000Z',
          startOffsetSeconds: 3600,
          endOffsetSeconds: 3600,
          stages: [
            { start: '2026-11-08T22:40:00.000Z', end: '2026-11-08T23:30:00.000Z', type: 4 },
            { start: '2026-11-08T23:30:00.000Z', end: '2026-11-09T01:00:00.000Z', type: 5 },
          ],
        },
      ]),
    )
    const fromFile = readHealthConnectSleep(database).records[0]
    database.close()

    const fromPhone = fromPluginSleepRecord(pluginNight())

    for (const field of ['uuid', 'startMs', 'endMs', 'startOffsetSeconds', 'endOffsetSeconds', 'stages'] as const) {
      expect(fromPhone[field], field).toEqual(fromFile[field])
    }

    // Converted with the shared function: same duplicate key, times, offsets and stages.
    const options = { id: 'x', importedAt: '2026-11-11T00:00:00.000Z' }
    const a = toSleepSession(fromFile, options)
    const b = toSleepSession(fromPhone, options)
    expect(b.dedupeKey).toBe(`health_connect:id:${UUID}`)
    expect({ ...b, metadata: null, sourceApp: null }).toEqual({ ...a, metadata: null, sourceApp: null })
  })

  it('accepts Date objects as well as UTC text, and keeps metadata', () => {
    const record = fromPluginSleepRecord(
      pluginNight({ startTime: new Date('2026-11-08T22:30:00Z'), title: 'Night', notes: 'Note' }),
    )
    expect(record.startMs).toBe(Date.parse('2026-11-08T22:30:00Z'))
    expect(record).toMatchObject({
      title: 'Night',
      notes: 'Note',
      packageName: 'com.example.sleep',
      clientRecordVersion: '0',
      lastModifiedMs: Date.parse('2026-11-09T08:00:00Z'),
    })
  })

  it('keeps a missing time zone as null and refuses records without an id or with bad times', () => {
    expect(fromPluginSleepRecord(pluginNight({ startZoneOffset: undefined })).startOffsetSeconds).toBeNull()
    expect(() => fromPluginSleepRecord(pluginNight({ metadata: {} }))).toThrow('no Health Connect id')
    expect(() => fromPluginSleepRecord(pluginNight({ endTime: 'yesterday' }))).toThrow('invalid end time')
  })
})
