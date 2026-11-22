import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { db } from './db'
import {
  buildSleepDedupeKey,
  createManualSleepSession,
  deleteSleepSession,
  restoreSleepSession,
  sleepSessionZone,
  updateSleepSession,
} from './sleepSessions'
import type { SleepSession } from './types'

const BED = '2026-11-08T22:30:00.000Z'
const WAKE = '2026-11-09T06:15:00.000Z'

function importedSession(overrides: Partial<SleepSession> = {}): SleepSession {
  return {
    id: 'hc-1',
    source: 'health_connect',
    externalId: 'abc',
    sourceApp: 'com.example',
    dedupeKey: 'health_connect:id:abc',
    startUtc: BED,
    endUtc: WAKE,
    timezone: null,
    startOffsetMinutes: 60,
    endOffsetMinutes: 60,
    stages: [],
    reportedSleepMs: null,
    comment: null,
    importedAt: '2026-11-09T08:00:00.000Z',
    metadata: { original: true },
    syncStatus: 'pending',
    revision: 1,
    syncedRevision: null,
    createdAt: '2026-11-09T08:00:00.000Z',
    updatedAt: '2026-11-09T08:00:00.000Z',
    deletedAt: null,
    ...overrides,
  }
}

describe('buildSleepDedupeKey and sleepSessionZone', () => {
  it('builds keys from the id, the external id or the times', () => {
    const base = { id: 'x', externalId: null, startUtc: BED, endUtc: WAKE }

    expect(buildSleepDedupeKey({ ...base, source: 'manual' })).toBe('manual:x')
    expect(buildSleepDedupeKey({ ...base, source: 'health_connect', externalId: 'abc' })).toBe('health_connect:id:abc')
    expect(buildSleepDedupeKey({ ...base, source: 'import' })).toBe(`import:time:${BED}:${WAKE}`)
  })

  it('uses the timezone, else the UTC offset, else UTC', () => {
    expect(sleepSessionZone({ timezone: 'Europe/Paris', startOffsetMinutes: 60 })).toBe('Europe/Paris')
    expect(sleepSessionZone({ timezone: null, startOffsetMinutes: -330 })).toBe('-05:30')
    expect(sleepSessionZone({ timezone: null, startOffsetMinutes: null })).toBe('UTC')
  })
})

describe('sleep session operations', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(async () => {
    db.close()
    await db.delete()
  })

  describe('createManualSleepSession', () => {
    it('stores a manual session in the device timezone by default', async () => {
      const session = await createManualSleepSession({
        startUtc: '2026-11-08T23:30:00+01:00',
        endUtc: '2026-11-09T07:15:00+01:00',
        comment: '  Woke up once ',
      })

      expect(session).toMatchObject({
        source: 'manual',
        externalId: null,
        dedupeKey: `manual:${session.id}`,
        startUtc: BED,
        endUtc: WAKE,
        // Tests run with TZ=America/New_York.
        timezone: 'America/New_York',
        startOffsetMinutes: null,
        stages: [],
        reportedSleepMs: null,
        comment: 'Woke up once',
        importedAt: null,
        syncStatus: 'pending',
        revision: 1,
        deletedAt: null,
      })
      expect(await db.sleepSessions.get(session.id)).toEqual(session)
    })

    it('rejects a wake time not after the bedtime', async () => {
      await expect(createManualSleepSession({ startUtc: WAKE, endUtc: BED })).rejects.toThrow(
        'The wake time must be after the bedtime.',
      )
      await expect(createManualSleepSession({ startUtc: BED, endUtc: BED })).rejects.toThrow(
        'The wake time must be after the bedtime.',
      )
    })

    it('accepts exactly 48 hours and rejects longer sessions', async () => {
      await createManualSleepSession({ startUtc: '2026-11-01T00:00:00Z', endUtc: '2026-11-03T00:00:00Z' })

      await expect(
        createManualSleepSession({ startUtc: '2026-11-05T00:00:00Z', endUtc: '2026-11-07T00:00:01Z' }),
      ).rejects.toThrow('A sleep session cannot last more than 48 hours.')
    })

    it('rejects timestamps without an offset and unknown timezones', async () => {
      await expect(createManualSleepSession({ startUtc: '2026-11-08T23:30:00', endUtc: WAKE })).rejects.toThrow(
        'Timestamp must be an ISO 8601 date-time with a timezone.',
      )
      await expect(createManualSleepSession({ startUtc: BED, endUtc: WAKE, timezone: 'Mars/Olympus' })).rejects.toThrow(
        'Invalid IANA timezone.',
      )
    })

    it('refuses an identical manual session, but allows it once the first is deleted', async () => {
      const first = await createManualSleepSession({ startUtc: BED, endUtc: WAKE })

      await expect(createManualSleepSession({ startUtc: BED, endUtc: WAKE })).rejects.toThrow(
        'A manual sleep session with the same bedtime and wake time already exists.',
      )

      await deleteSleepSession(first.id)
      const second = await createManualSleepSession({ startUtc: BED, endUtc: WAKE })

      // Restoring the first would now create a duplicate.
      await expect(restoreSleepSession(first.id)).rejects.toThrow('same bedtime and wake time')

      await deleteSleepSession(second.id)
      expect((await restoreSleepSession(first.id)).deletedAt).toBeNull()
    })

    it('allows a manual session at the same times as an imported one', async () => {
      await db.sleepSessions.add(importedSession())

      await expect(createManualSleepSession({ startUtc: BED, endUtc: WAKE })).resolves.toBeDefined()
    })
  })

  describe('updateSleepSession', () => {
    it('updates the times, timezone and comment of a manual session', async () => {
      const session = await createManualSleepSession({ startUtc: BED, endUtc: WAKE })

      const updated = await updateSleepSession(session.id, {
        endUtc: '2026-11-09T07:00:00Z',
        timezone: 'Europe/Paris',
        comment: 'Late alarm',
      })

      expect(updated).toMatchObject({
        startUtc: BED,
        endUtc: '2026-11-09T07:00:00.000Z',
        timezone: 'Europe/Paris',
        comment: 'Late alarm',
        revision: 2,
        dedupeKey: `manual:${session.id}`,
      })
    })

    it('refuses changes that would duplicate another manual session', async () => {
      await createManualSleepSession({ startUtc: BED, endUtc: WAKE })
      const other = await createManualSleepSession({ startUtc: BED, endUtc: '2026-11-09T07:00:00Z' })

      await expect(updateSleepSession(other.id, { endUtc: WAKE })).rejects.toThrow('same bedtime and wake time')
    })

    it('only allows the comment of an imported session to change', async () => {
      await db.sleepSessions.add(importedSession())

      await expect(updateSleepSession('hc-1', { endUtc: '2026-11-09T07:00:00Z' })).rejects.toThrow(
        'Imported sleep sessions keep their original times; only the comment can be changed.',
      )

      const updated = await updateSleepSession('hc-1', { comment: 'Restless' })

      expect(updated).toMatchObject({
        comment: 'Restless',
        startUtc: BED,
        endUtc: WAKE,
        metadata: { original: true },
        revision: 2,
      })
    })

    it('refuses deleted or unknown sessions', async () => {
      const session = await createManualSleepSession({ startUtc: BED, endUtc: WAKE })
      await deleteSleepSession(session.id)

      await expect(updateSleepSession(session.id, { comment: 'x' })).rejects.toThrow('Sleep session not found.')
      await expect(updateSleepSession('missing', { comment: 'x' })).rejects.toThrow('Sleep session not found.')
    })
  })

  describe('delete and restore', () => {
    it('soft-deletes and restores a session, updating sync fields', async () => {
      const session = await createManualSleepSession({ startUtc: BED, endUtc: WAKE })

      await deleteSleepSession(session.id)
      const deleted = await db.sleepSessions.get(session.id)
      expect(deleted?.deletedAt).not.toBeNull()
      expect(deleted?.revision).toBe(2)

      const restored = await restoreSleepSession(session.id)
      expect(restored.deletedAt).toBeNull()
      expect(restored.revision).toBe(3)
    })

    it('refuses to restore a session that is not deleted', async () => {
      const session = await createManualSleepSession({ startUtc: BED, endUtc: WAKE })

      await expect(restoreSleepSession(session.id)).rejects.toThrow('This sleep session is not deleted.')
    })
  })
})
