import { describe, expect, it } from 'vitest'

import { toSleepSession } from './healthConnect'
import { fromPluginSleepRecord, type PluginSleepRecord } from './healthConnectDevice'
import { DEVICE_SOURCE_NAME, planDeviceSleepImport } from './deviceSleepImport'

const NOW = new Date('2026-11-11T12:00:00.000Z')
let counter = 0
const options = (historyGranted = true) => ({
  importedAt: NOW.toISOString(),
  newId: () => `new-${++counter}`,
  historyGranted,
  now: NOW,
})

function night(id: string, start: string, end: string, lastModified = '2026-11-01T08:00:00Z'): PluginSleepRecord {
  return {
    metadata: { id, clientRecordVersion: 0, lastModifiedTime: lastModified, dataOrigin: 'com.example.sleep' },
    startTime: start,
    startZoneOffset: '+01:00',
    endTime: end,
    endZoneOffset: '+01:00',
    stages: [{ startTime: start, endTime: end, stage: 2 }],
  }
}

/** A session already in the app, as imported earlier from the same record. */
function stored(record: PluginSleepRecord, localId: string) {
  return toSleepSession(fromPluginSleepRecord(record), { id: localId, importedAt: '2026-11-01T09:00:00.000Z' })
}

const OLD = night('aaaaaaaa-0000-4000-8000-000000000001', '2026-09-01T22:00:00Z', '2026-09-02T06:00:00Z')
const RECENT = night('aaaaaaaa-0000-4000-8000-000000000002', '2026-11-08T22:00:00Z', '2026-11-09T06:00:00Z')
const NEW = night('aaaaaaaa-0000-4000-8000-000000000003', '2026-11-10T22:30:00Z', '2026-11-11T06:30:00Z')

describe('planDeviceSleepImport', () => {
  it('imports only new nights and skips the ones already in the app', () => {
    const plan = planDeviceSleepImport([OLD, RECENT, NEW], [stored(OLD, 'l1'), stored(RECENT, 'l2')], options())

    expect(plan.fileName).toBe(DEVICE_SOURCE_NAME)
    expect(plan.found).toBe(3)
    expect(plan.toAdd.map((s) => s.externalId)).toEqual([NEW.metadata!.id])
    expect(plan.duplicates).toHaveLength(2)
    expect(plan.needsAttention).toEqual([])
    expect(plan.toAdd[0]).toMatchObject({
      source: 'health_connect',
      dedupeKey: `health_connect:id:${NEW.metadata!.id}`,
      startOffsetMinutes: 60,
      syncStatus: 'pending',
    })
  })

  it('flags a night changed in Health Connect and keeps the app version', () => {
    const changed = { ...RECENT, metadata: { ...RECENT.metadata, lastModifiedTime: '2026-11-10T07:00:00Z' } }
    const plan = planDeviceSleepImport([changed], [stored(RECENT, 'l2')], options())
    expect(plan.toAdd).toEqual([])
    expect(plan.needsAttention[0].reason).toMatch(/changed in Health Connect/)
  })

  it('flags nights no longer in Health Connect, never deletes them', () => {
    const plan = planDeviceSleepImport([NEW], [stored(OLD, 'l1'), stored(RECENT, 'l2')], options())
    expect(plan.needsAttention.map((issue) => issue.reason)).toEqual([
      expect.stringMatching(/no longer in Health Connect/),
      expect.stringMatching(/no longer in Health Connect/),
    ])
  })

  it('without the past-data permission, checks only the last 30 days for missing nights', () => {
    const plan = planDeviceSleepImport([NEW], [stored(OLD, 'l1'), stored(RECENT, 'l2')], options(false))
    expect(plan.needsAttention).toHaveLength(1)
    expect(plan.needsAttention[0].label).toContain('2026-11-08 22:00')
  })

  it('ignores manual and deleted sessions for the missing check', () => {
    const deleted = { ...stored(RECENT, 'l2'), deletedAt: '2026-11-10T00:00:00.000Z' }
    const manual = { ...stored(OLD, 'l1'), source: 'manual' as const, externalId: null, dedupeKey: 'manual:l1' }
    const plan = planDeviceSleepImport([], [deleted, manual], options())
    expect(plan.needsAttention).toEqual([])
  })

  it('lists unreadable records as invalid instead of dropping them silently', () => {
    const plan = planDeviceSleepImport([NEW, { metadata: {}, startTime: '2026-11-05T22:00:00Z' }], [], options())
    expect(plan.found).toBe(2)
    expect(plan.toAdd).toHaveLength(1)
    expect(plan.invalid).toEqual([{ label: 'Sleep session starting 2026-11-05 22:00 UTC', reason: 'the record has no Health Connect id' }])
  })

  it('keeps a second record of the same night (other id) and explains it', () => {
    const copy = night('bbbbbbbb-0000-4000-8000-000000000009', '2026-11-08T22:00:00Z', '2026-11-09T06:00:00Z')
    const plan = planDeviceSleepImport([RECENT, copy], [stored(RECENT, 'l2')], options())
    expect(plan.toAdd.map((s) => s.externalId)).toEqual([copy.metadata!.id])
    expect(plan.notes).toContainEqual(expect.stringMatching(/1 session\(s\) have exactly the same bedtime and wake time/))
  })
})
