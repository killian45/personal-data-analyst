// Two simulated devices synchronising through an in-memory server.
// Device A is the app's own database (so records are created by the real
// app functions); device B is a second database edited directly.
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { db, PersonalDataDatabase } from '../database/db'
import { createEntry, deleteEntry, updateEntry } from '../database/entries'
import { createContact, deleteContact, restoreContact, updateContact } from '../database/contacts'
import { createInteraction, updateInteraction } from '../database/contactInteractions'
import { createHabit, setHabitArchived } from '../database/habits'
import { deleteExternalSample } from '../database/externalSamples'
import { createManualSleepSession } from '../database/sleepSessions'
import { startStopwatch } from '../database/stopwatches'
import { nextSyncFields } from '../database/sync'
import type { SleepSession } from '../database/types'
import { saveDisplayTimezone } from '../settings/displayTimezone'
import { locationSamples } from '../location/testLocation'
import { screenTimeSample } from '../screenTime/testScreenTime'
import { saveSleepTargets } from '../settings/sleepTargets'
import { createKeys, encryptRecord } from './crypto'
import { conflictId, resolveConflict, runSyncRound, type SyncRoundResult } from './engine'
import { uploadContent } from './merge'
import { SyncServerError } from './server'
import { createMemoryServer, type MemoryServer } from './testing/memoryServer'

const USER = 'user-1'
let dataKey: CryptoKey
let deviceB: PersonalDataDatabase
let server: MemoryServer

beforeAll(async () => {
  dataKey = (await createKeys('correct horse battery staple', { iterations: 100_000 })).dataKey
})

async function link(device: PersonalDataDatabase) {
  await device.syncState.put({
    id: 'current',
    userId: USER,
    lastServerSeq: 0,
    keyVersion: 1,
    dataKey,
    linkedAt: '2026-11-10T00:00:00.000Z',
  })
}

beforeEach(async () => {
  await db.delete()
  await db.open()
  deviceB = new PersonalDataDatabase('device-B')
  await deviceB.delete()
  await deviceB.open()
  server = createMemoryServer(USER)
  await link(db)
  await link(deviceB)
})

afterEach(async () => {
  db.close()
  await db.delete()
  deviceB.close()
  await deviceB.delete()
})

function sync(device: PersonalDataDatabase) {
  return runSyncRound({ db: device, server, now: () => new Date('2026-11-10T12:00:00.000Z') })
}

async function syncOk(device: PersonalDataDatabase) {
  const result = await sync(device)
  if (result.status !== 'ok') throw new Error(`sync returned ${JSON.stringify(result)}`)
  return result
}

/** A local edit on device B, the way the app records one. */
async function editOnB(table: 'habits' | 'entries' | 'sleepSessions' | 'settings' | 'contacts' | 'contactInteractions', id: string, changes: object) {
  const records = deviceB.table(table)
  const record = await records.get(id)
  await records.put({ ...record, ...changes, ...nextSyncFields(record), updatedAt: new Date().toISOString() })
}

async function contents(device: PersonalDataDatabase) {
  const byId = <T extends { id: string }>(rows: T[]) => [...rows].sort((a, b) => a.id.localeCompare(b.id))
  return {
    habits: byId(await device.habits.toArray()),
    entries: byId(await device.entries.toArray()),
    sleepSessions: byId(await device.sleepSessions.toArray()),
    settings: await device.settings.orderBy('key').toArray(),
  }
}

function importedSession(id: string, externalId: string): SleepSession {
  return {
    id,
    source: 'health_connect',
    externalId,
    sourceApp: 'com.example.sleep',
    dedupeKey: `health_connect:id:${externalId}`,
    startUtc: '2026-11-07T22:00:00.000Z',
    endUtc: '2026-11-08T06:00:00.000Z',
    timezone: null,
    startOffsetMinutes: 60,
    endOffsetMinutes: 60,
    stages: [{ start: '2026-11-07T22:10:00.000Z', end: '2026-11-07T23:00:00.000Z', stage: 'light' }],
    reportedSleepMs: null,
    comment: null,
    importedAt: '2026-11-09T08:00:00.000Z',
    metadata: { recordingMethod: 2 },
    syncStatus: 'pending',
    revision: 1,
    syncedRevision: null,
    createdAt: '2026-11-09T08:00:00.000Z',
    updatedAt: '2026-11-09T08:00:00.000Z',
    deletedAt: null,
  } as SleepSession
}

/** Realistic data on device A: 9 synchronisable records + a running stopwatch. */
async function seedDeviceA() {
  const water = await createHabit({ name: 'Water', type: 'number', unit: 'ml' })
  const reading = await createHabit({ name: 'Reading', type: 'stopwatch' })
  const morning = await createEntry({
    habitId: water.id,
    value: 500,
    occurredStart: '2026-11-09T08:00:00.000Z',
    comment: 'Morning',
  })
  const removed = await createEntry({ habitId: water.id, value: 250, occurredStart: '2026-11-09T12:00:00.000Z' })
  await deleteEntry(removed.id)
  await createManualSleepSession({ startUtc: '2026-11-08T22:30:00.000Z', endUtc: '2026-11-09T06:15:00.000Z' })
  await db.sleepSessions.add(importedSession('sleep-hc-1', 'hc-1'))
  await saveDisplayTimezone('Europe/Paris')
  await saveSleepTargets({ sleepDuration: '7:30', bedtime: '23:00', wakeTime: '' })
  await startStopwatch(reading.id)
  return { water, reading, morning, removed }
}

/** Both devices hold the same synced data. */
async function syncedPair() {
  const seeded = await seedDeviceA()
  await syncOk(db)
  await syncOk(deviceB)
  return seeded
}

describe('sync round: preconditions', () => {
  it('does nothing until sync is set up on the device', async () => {
    await db.syncState.clear()
    expect(await sync(db)).toEqual({ status: 'not-set-up' })
  })

  it('refuses to sync when signed out or signed in as another account', async () => {
    server.signedInAs = null
    expect(await sync(db)).toEqual({ status: 'signed-out' })
    server.signedInAs = 'someone-else'
    expect(await sync(db)).toEqual({ status: 'account-mismatch' })
    expect(server.rows()).toEqual([])
  })

  it('runs only one round at a time per device', async () => {
    await seedDeviceA()
    const results = await Promise.all([sync(db), sync(db)])
    expect(results.map((r) => r.status).sort()).toEqual(['busy', 'ok'])
  })
})

describe('first synchronisation', () => {
  it('uploads every record except running stopwatches, encrypted, and marks them synced', async () => {
    await seedDeviceA()

    const result = await syncOk(db)

    expect(result.pushed).toBe(9)
    expect(result.notPushed).toEqual([])
    const rows = server.rows()
    expect(rows).toHaveLength(9)
    expect(new Set(rows.map((r) => r.collection))).toEqual(new Set(['habits', 'entries', 'sleepSessions', 'settings']))

    const everything = JSON.stringify(rows.map((r) => [...r.ciphertext]))
    const asText = rows.map((r) => new TextDecoder('latin1').decode(r.ciphertext)).join('')
    expect(asText).not.toMatch(/Water|Morning|Europe\/Paris|health_connect/)
    expect(everything.length).toBeGreaterThan(0)

    const local = await contents(db)
    for (const record of [...local.habits, ...local.entries, ...local.sleepSessions, ...local.settings]) {
      expect(record.syncStatus).toBe('synced')
      expect(record.syncedRevision).toBe(record.revision)
    }
  })

  it('gives a second device an exact copy (but not the running stopwatch)', async () => {
    await seedDeviceA()
    await syncOk(db)

    const result = await syncOk(deviceB)

    expect(result).toMatchObject({ pulled: 9, applied: 9, conflicts: 0, problems: 0, pushed: 0 })
    expect(await contents(deviceB)).toEqual(await contents(db))
    expect(await deviceB.activeTimers.count()).toBe(0)
    expect((await deviceB.syncState.get('current'))?.lastServerSeq).toBe(9)
  })

  it('applies entries even when their habit was changed after them', async () => {
    const { water } = await seedDeviceA()
    await setHabitArchived(water.id, true) // the habit now has a higher server_seq than its entries
    await syncOk(db)

    const result = await syncOk(deviceB)

    expect(result.problems).toBe(0)
    expect(await deviceB.entries.count()).toBe(2)
    expect((await deviceB.habits.get(water.id))?.archived).toBe(true)
  })

  it('a device syncing again downloads its own uploads but changes nothing', async () => {
    await seedDeviceA()
    await syncOk(db)
    const before = await contents(db)

    const again = await syncOk(db)

    expect(again).toMatchObject({ applied: 0, conflicts: 0, problems: 0, pushed: 0 })
    expect(await contents(db)).toEqual(before)
  })
})

describe('changes between devices', () => {
  it('an edit on one device reaches the other', async () => {
    const { water } = await syncedPair()
    await editOnB('habits', water.id, { name: 'Water 💧' })

    expect((await syncOk(deviceB)).pushed).toBe(1)
    expect((await syncOk(db)).applied).toBe(1)

    expect((await db.habits.get(water.id))?.name).toBe('Water 💧')
    expect(await contents(db)).toEqual(await contents(deviceB))
  })

  it('offline edits to different records on both devices all arrive', async () => {
    const { water, morning } = await syncedPair()
    await updateEntry(morning.id, { comment: 'Edited on A' })
    await editOnB('habits', water.id, { color: '#16a34a' })

    await syncOk(db)
    await syncOk(deviceB)
    await syncOk(db)

    expect(await contents(db)).toEqual(await contents(deviceB))
    expect((await deviceB.entries.get(morning.id))?.comment).toBe('Edited on A')
    expect((await db.habits.get(water.id))?.color).toBe('#16a34a')
  })

  it('removing a sleep target reaches the other device as a removal', async () => {
    await syncedPair()
    await saveSleepTargets({ sleepDuration: '', bedtime: '23:00', wakeTime: '' })

    await syncOk(db)
    await syncOk(deviceB)

    expect(await deviceB.settings.get('target.sleepDuration')).toMatchObject({
      value: '7:30',
      deletedAt: expect.any(String),
      syncStatus: 'synced',
    })
  })

  it('a record edited during its own upload stays pending and is uploaded next round', async () => {
    const water = await createHabit({ name: 'Water', type: 'number', unit: 'ml' })
    let edited = false
    server.beforePush = async () => {
      if (!edited) {
        edited = true
        await setHabitArchived(water.id, true)
      }
    }

    await syncOk(db)
    expect(await db.habits.get(water.id)).toMatchObject({ syncStatus: 'pending', revision: 2, syncedRevision: 1 })

    expect((await syncOk(db)).pushed).toBe(1)
    expect(await db.habits.get(water.id)).toMatchObject({ syncStatus: 'synced', revision: 2, syncedRevision: 2 })
    expect(server.rows()[0].revision).toBe(2)
  })
})

describe('conflicts (rules 1, 3 and 4)', () => {
  it('the same change made on both devices is not a conflict', async () => {
    const { morning } = await syncedPair()
    await updateEntry(morning.id, { comment: 'Same' })
    await editOnB('entries', morning.id, { comment: 'Same' })

    await syncOk(db)
    const result = await syncOk(deviceB)

    expect(result.conflicts).toBe(0)
    expect(await deviceB.syncConflicts.count()).toBe(0)
    expect(await contents(deviceB)).toEqual(await contents(db))
  })

  it('different changes to the same record: both versions kept, nothing overwritten', async () => {
    const { morning } = await syncedPair()
    await updateEntry(morning.id, { comment: 'From A' })
    await editOnB('entries', morning.id, { comment: 'From B' })

    await syncOk(db)
    const result = await syncOk(deviceB)

    expect(result).toMatchObject({ conflicts: 1, pushed: 0 })
    expect(await deviceB.entries.get(morning.id)).toMatchObject({ comment: 'From B', syncStatus: 'conflict' })
    const issue = await deviceB.syncConflicts.get(conflictId('entries', morning.id))
    expect(issue).toMatchObject({ kind: 'conflict', remoteRevision: 2 })
    expect(issue?.remoteRecord).toMatchObject({ comment: 'From A' })

    // Syncing again neither uploads B's version nor creates a second conflict.
    expect(await syncOk(deviceB)).toMatchObject({ conflicts: 0, pushed: 0 })
    expect(await deviceB.syncConflicts.count()).toBe(1)
    expect((await db.entries.get(morning.id))?.comment).toBe('From A')
  })

  it('"keep this device\'s version" uploads it and the other device receives it', async () => {
    const { morning } = await syncedPair()
    await updateEntry(morning.id, { comment: 'From A' })
    await editOnB('entries', morning.id, { comment: 'From B' })
    await syncOk(db)
    await syncOk(deviceB)

    await resolveConflict(deviceB, conflictId('entries', morning.id), 'keep-this-device')
    expect(await deviceB.entries.get(morning.id)).toMatchObject({
      comment: 'From B',
      syncStatus: 'pending',
      syncedRevision: 2,
      revision: 3,
    })

    expect((await syncOk(deviceB)).pushed).toBe(1)
    expect((await syncOk(db)).applied).toBe(1)
    expect((await db.entries.get(morning.id))?.comment).toBe('From B')
    expect(await contents(db)).toEqual(await contents(deviceB))
    expect(await deviceB.syncConflicts.count()).toBe(0)
  })

  it('"keep the other version" takes it without uploading anything', async () => {
    const { morning } = await syncedPair()
    await updateEntry(morning.id, { comment: 'From A' })
    await editOnB('entries', morning.id, { comment: 'From B' })
    await syncOk(db)
    await syncOk(deviceB)

    await resolveConflict(deviceB, conflictId('entries', morning.id), 'keep-other')

    expect(await deviceB.entries.get(morning.id)).toMatchObject({ comment: 'From A', syncStatus: 'synced' })
    expect((await syncOk(deviceB)).pushed).toBe(0)
    expect((await syncOk(db)).applied).toBe(0)
    expect(await contents(db)).toEqual(await contents(deviceB))
  })

  it('deleted on one device, edited on the other: the user decides (both directions)', async () => {
    const { morning } = await syncedPair()

    // Deleted on A first, edited on B.
    await deleteEntry(morning.id)
    await editOnB('entries', morning.id, { comment: 'Still wanted' })
    await syncOk(db)
    expect((await syncOk(deviceB)).conflicts).toBe(1)
    expect(await deviceB.entries.get(morning.id)).toMatchObject({ deletedAt: null, comment: 'Still wanted' })
    const issue = await deviceB.syncConflicts.get(conflictId('entries', morning.id))
    expect(issue?.remoteRecord).toMatchObject({ deletedAt: expect.any(String) })

    // B keeps its edit; then A edits nothing and B's version wins on A.
    await resolveConflict(deviceB, conflictId('entries', morning.id), 'keep-this-device')
    await syncOk(deviceB)
    await syncOk(db)
    expect(await db.entries.get(morning.id)).toMatchObject({ deletedAt: null, comment: 'Still wanted' })

    // Now edited on A, deleted on B, A syncs first.
    await updateEntry(morning.id, { comment: 'Edited on A' })
    await editOnB('entries', morning.id, { deletedAt: new Date().toISOString() })
    await syncOk(db)
    expect((await syncOk(deviceB)).conflicts).toBe(1)
    expect((await deviceB.entries.get(morning.id))?.deletedAt).not.toBeNull()
  })

  it('restored backup records that match the server are marked synced, not conflicts', async () => {
    await syncedPair()
    // Restore marks every record pending and never synchronised.
    for (const table of ['habits', 'entries', 'sleepSessions', 'settings'] as const) {
      const rows = await deviceB.table(table).toArray()
      await deviceB.table(table).bulkPut(rows.map((r) => ({ ...r, syncStatus: 'pending', syncedRevision: null })))
    }

    const result = await syncOk(deviceB)

    expect(result).toMatchObject({ conflicts: 0, problems: 0, pushed: 0 })
    expect(await contents(deviceB)).toEqual(await contents(db))
  })
})

describe('server records that cannot be used are kept aside (rules 8 and 9)', () => {
  it('a Health Connect night imported on both devices before syncing: listed, nothing dropped', async () => {
    await db.sleepSessions.add(importedSession('a-copy', 'hc-9'))
    await deviceB.sleepSessions.add(importedSession('b-copy', 'hc-9'))

    await syncOk(db)
    const result = await syncOk(deviceB)

    expect(result.problems).toBe(1)
    expect((await deviceB.sleepSessions.toArray()).map((s) => s.id)).toEqual(['b-copy'])
    const issue = await deviceB.syncConflicts.get(conflictId('sleepSessions', 'a-copy'))
    expect(issue).toMatchObject({ kind: 'invalid-remote', reason: expect.stringMatching(/same source record/) })
    // B's own copy was still uploaded: both versions exist on the server.
    expect(server.rows().map((r) => r.recordId).sort()).toEqual(['a-copy', 'b-copy'])
  })

  it('a record that cannot be decrypted is listed once and not applied', async () => {
    server.inject({
      collection: 'habits',
      recordId: 'damaged',
      revision: 1,
      ciphertext: crypto.getRandomValues(new Uint8Array(64)),
      iv: crypto.getRandomValues(new Uint8Array(12)),
      keyVersion: 1,
    })

    expect((await syncOk(deviceB)).problems).toBe(1)
    expect(await deviceB.habits.get('damaged')).toBeUndefined()
    expect(await deviceB.syncConflicts.get('habits:damaged')).toMatchObject({
      kind: 'invalid-remote',
      reason: expect.stringMatching(/cannot be decrypted/),
    })
    expect((await deviceB.syncState.get('current'))?.lastServerSeq).toBe(1)
    expect((await syncOk(deviceB)).problems).toBe(0)
  })

  it('a record moved to another id is detected (cannot be decrypted)', async () => {
    const encrypted = await encryptRecord(
      dataKey,
      { userId: USER, collection: 'habits', recordId: 'original', revision: 1, keyVersion: 1 },
      { id: 'original', name: 'Moved' },
    )
    if (encrypted.status !== 'ok') throw new Error('encrypt failed')
    server.inject({ collection: 'habits', recordId: 'moved', revision: 1, keyVersion: 1, ...encrypted })

    expect((await syncOk(deviceB)).problems).toBe(1)
    expect(await deviceB.habits.count()).toBe(0)
  })

  it('a record that decrypts but breaks the app rules is listed with the reason', async () => {
    const record = {
      id: 'bad-habit', name: 'Bad', type: 'banana', unit: null, labelOptions: null, color: '#2563eb',
      archived: false, sortOrder: 0, createdAt: '2026-11-10T08:00:00.000Z',
      updatedAt: '2026-11-10T08:00:00.000Z', deletedAt: null,
    }
    const encrypted = await encryptRecord(
      dataKey,
      { userId: USER, collection: 'habits', recordId: 'bad-habit', revision: 1, keyVersion: 1 },
      record,
    )
    if (encrypted.status !== 'ok') throw new Error('encrypt failed')
    server.inject({ collection: 'habits', recordId: 'bad-habit', revision: 1, keyVersion: 1, ...encrypted })

    expect((await syncOk(deviceB)).problems).toBe(1)
    expect(await deviceB.habits.count()).toBe(0)
    const issue = await deviceB.syncConflicts.get('habits:bad-habit')
    expect(issue).toMatchObject({ kind: 'invalid-remote', remoteRecord: record })
  })

  it('when the server copy of a local record is unusable, keeping this device\'s version repairs it', async () => {
    const { water } = await syncedPair()
    server.inject({
      collection: 'habits',
      recordId: water.id,
      revision: 5,
      ciphertext: crypto.getRandomValues(new Uint8Array(64)),
      iv: crypto.getRandomValues(new Uint8Array(12)),
      keyVersion: 1,
    })

    expect((await syncOk(deviceB)).problems).toBe(1)
    expect((await deviceB.habits.get(water.id))?.syncStatus).toBe('conflict')

    await resolveConflict(deviceB, conflictId('habits', water.id), 'keep-this-device')
    expect((await syncOk(deviceB)).pushed).toBe(1)
    await syncOk(db)
    expect(await db.syncConflicts.count()).toBe(0)
    expect((await db.habits.get(water.id))?.revision).toBe(6)
  })
})

describe('screen time (imported samples)', () => {
  it('a screen-time day reaches the other device, and so does its deletion', async () => {
    await db.externalSamples.add(screenTimeSample('day-9'))
    await syncOk(db)
    await syncOk(deviceB)
    expect(await deviceB.externalSamples.get('day-9')).toMatchObject({ value: 4380, syncStatus: 'synced', revision: 1 })

    await deleteExternalSample('day-9')
    await syncOk(db)
    await syncOk(deviceB)
    expect((await deviceB.externalSamples.get('day-9'))?.deletedAt).not.toBeNull()
  })

  it('location visits and movements reach the other device', async () => {
    await db.externalSamples.bulkAdd(locationSamples())
    await syncOk(db)
    const result = await syncOk(deviceB)
    expect(result.problems).toBe(0)
    expect((await deviceB.externalSamples.toArray()).map((sample) => [sample.id, sample.syncStatus])).toEqual([
      ['move-1', 'synced'],
      ['visit-1', 'synced'],
    ])
  })

  it('the same day imported on both devices before syncing: listed, nothing dropped', async () => {
    await db.externalSamples.add(screenTimeSample('a-day'))
    await deviceB.externalSamples.add(screenTimeSample('b-day'))

    await syncOk(db)
    const result = await syncOk(deviceB)

    expect(result.problems).toBe(1)
    expect((await deviceB.externalSamples.toArray()).map((s) => s.id)).toEqual(['b-day'])
    const issue = await deviceB.syncConflicts.get(conflictId('externalSamples', 'a-day'))
    expect(issue).toMatchObject({ kind: 'invalid-remote', reason: expect.stringMatching(/same record from the same source/) })
  })

  it('a screen-time record that breaks the rules is listed with the reason, not applied', async () => {
    const bad = screenTimeSample('bad-day', '2026-11-09', { value: 100_000 })
    const encrypted = await encryptRecord(
      dataKey,
      { userId: USER, collection: 'externalSamples', recordId: 'bad-day', revision: 1, keyVersion: 1 },
      bad,
    )
    if (encrypted.status !== 'ok') throw new Error('encrypt failed')
    server.inject({ collection: 'externalSamples', recordId: 'bad-day', revision: 1, keyVersion: 1, ...encrypted })

    const result = await syncOk(deviceB)
    expect(result.problems).toBe(1)
    expect(await deviceB.externalSamples.count()).toBe(0)
    expect(await deviceB.syncConflicts.get(conflictId('externalSamples', 'bad-day'))).toMatchObject({
      reason: expect.stringMatching(/more than the length of the day/),
    })
  })
})

describe('server rollback (security review 2026-11-12)', () => {
  it('an older server version is refused, and this device\'s newer version is sent again', async () => {
    const { morning } = await syncedPair()
    const rowAtRevision1 = server.rows().find((row) => row.collection === 'entries' && row.recordId === morning.id)
    if (!rowAtRevision1) throw new Error('missing row')

    await updateEntry(morning.id, { comment: 'Revision 2' })
    await syncOk(db)
    await syncOk(deviceB)
    expect(await deviceB.entries.get(morning.id)).toMatchObject({ comment: 'Revision 2', revision: 2, syncedRevision: 2 })

    // The server goes back to the revision 1 copy (restore or tampering).
    const { serverSeq: _seq, ...oldRow } = rowAtRevision1
    server.inject(oldRow)

    const result = await syncOk(deviceB)
    expect(result).toMatchObject({ applied: 0, conflicts: 0, stale: 1, pushed: 1 })
    expect(await deviceB.entries.get(morning.id)).toMatchObject({ comment: 'Revision 2', revision: 2, syncedRevision: 2, syncStatus: 'synced' })
    expect(server.rows().find((row) => row.recordId === morning.id)?.revision).toBe(2)

    // The other device is unaffected and sees nothing new.
    expect(await syncOk(db)).toMatchObject({ applied: 0, stale: 0 })
    expect((await db.entries.get(morning.id))?.comment).toBe('Revision 2')
  })

  it('a record edited here meanwhile: the older server copy is refused too, the edit is sent', async () => {
    const { morning } = await syncedPair()
    const rowAtRevision1 = server.rows().find((row) => row.collection === 'entries' && row.recordId === morning.id)
    if (!rowAtRevision1) throw new Error('missing row')
    await updateEntry(morning.id, { comment: 'Revision 2' })
    await syncOk(db)

    const { serverSeq: _seq, ...oldRow } = rowAtRevision1
    server.inject(oldRow)
    await updateEntry(morning.id, { comment: 'Revision 3, edited offline' })

    expect(await syncOk(db)).toMatchObject({ conflicts: 0, stale: 1, pushed: 1 })
    expect(await db.entries.get(morning.id)).toMatchObject({ comment: 'Revision 3, edited offline', revision: 3, syncedRevision: 3 })
    await syncOk(deviceB)
    expect((await deviceB.entries.get(morning.id))?.comment).toBe('Revision 3, edited offline')
  })
})

describe('server rollback found while uploading', () => {
  it('an older copy that is not downloaded (restored rows keep old numbers) is found on upload and replaced', async () => {
    const { morning } = await syncedPair()
    const rowAtRevision1 = server.rows().find((row) => row.collection === 'entries' && row.recordId === morning.id)
    if (!rowAtRevision1) throw new Error('missing row')
    await updateEntry(morning.id, { comment: 'Revision 2' })
    await syncOk(db)

    const { serverSeq: _seq, ...oldRow } = rowAtRevision1
    const restored = server.inject(oldRow)
    // A restored row is not downloaded: its number is not above what this device already read.
    const state = await db.syncState.get('current')
    if (!state) throw new Error('not linked')
    await db.syncState.put({ ...state, lastServerSeq: restored.serverSeq })

    await updateEntry(morning.id, { comment: 'Revision 3' })
    expect(await syncOk(db)).toMatchObject({ pulled: 0, conflicts: 0, stale: 1, pushed: 1 })
    expect(server.rows().find((row) => row.recordId === morning.id)?.revision).toBe(3)
    expect(await db.entries.get(morning.id)).toMatchObject({ comment: 'Revision 3', syncStatus: 'synced', syncedRevision: 3 })
  })
})

describe('Personal CRM (contacts and interactions)', () => {
  it('a contact and its interactions reach the other device exactly, encrypted', async () => {
    const amelie = await createContact({ name: 'Amélie', birthday: '--05-17', address: '12 rue X\n75011 Paris', interests: 'Jazz', externalPhoneId: 'k1' })
    const lunch = await createInteraction({ contactId: amelie.id, text: 'Lunch at Chez Marcel', occurredStart: '2026-11-10T11:30:00.000Z', timezone: 'Europe/Paris' })

    expect(await syncOk(db)).toMatchObject({ pushed: 2 })
    // The server only holds ciphertext: no name or text in clear.
    const rows = server.rows().filter((row) => row.collection === 'contacts' || row.collection === 'contactInteractions')
    expect(rows).toHaveLength(2)
    const bytes = rows.map((row) => new TextDecoder().decode(row.ciphertext)).join('')
    expect(bytes).not.toContain('Amélie')
    expect(bytes).not.toContain('Chez Marcel')

    expect(await syncOk(deviceB)).toMatchObject({ applied: 2, conflicts: 0, problems: 0 })
    expect(await deviceB.contacts.get(amelie.id)).toEqual({ ...amelie, syncStatus: 'synced', syncedRevision: 1 })
    expect(await deviceB.contactInteractions.get(lunch.id)).toEqual({ ...lunch, syncStatus: 'synced', syncedRevision: 1 })
  })

  it('edits, deletion and restore travel too', async () => {
    const bob = await createContact({ name: 'Bob' })
    const call = await createInteraction({ contactId: bob.id, text: 'Call', occurredStart: '2026-11-10T09:00:00.000Z', timezone: 'Europe/Paris' })
    await syncOk(db)
    await syncOk(deviceB)

    await updateContact(bob.id, { dislikes: 'Noise' })
    await updateInteraction(call.id, { text: 'Long call' })
    await syncOk(db)
    await syncOk(deviceB)
    expect(await deviceB.contacts.get(bob.id)).toMatchObject({ dislikes: 'Noise', revision: 2 })
    expect(await deviceB.contactInteractions.get(call.id)).toMatchObject({ text: 'Long call', revision: 2 })

    await deleteContact(bob.id)
    await syncOk(db)
    await syncOk(deviceB)
    expect((await deviceB.contacts.get(bob.id))?.deletedAt).not.toBeNull()

    await restoreContact(bob.id)
    await syncOk(db)
    await syncOk(deviceB)
    expect(await deviceB.contacts.get(bob.id)).toMatchObject({ deletedAt: null, revision: 4 })
  })

  it('the same contact changed on both devices: both versions kept for the user, nothing overwritten', async () => {
    const bob = await createContact({ name: 'Bob', interests: 'Chess' })
    await syncOk(db)
    await syncOk(deviceB)

    await updateContact(bob.id, { interests: 'Chess, hiking' })
    await editOnB('contacts', bob.id, { interests: 'Chess, jazz' })
    await syncOk(db)
    const result = await syncOk(deviceB)

    expect(result).toMatchObject({ conflicts: 1, pushed: 0 })
    expect(await deviceB.contacts.get(bob.id)).toMatchObject({ interests: 'Chess, jazz', syncStatus: 'conflict' })
    const issue = await deviceB.syncConflicts.get(conflictId('contacts', bob.id))
    expect(issue?.remoteRecord).toMatchObject({ interests: 'Chess, hiking' })
    expect((await db.contacts.get(bob.id))?.interests).toBe('Chess, hiking')

    // The user keeps B's version: it reaches A.
    await resolveConflict(deviceB, conflictId('contacts', bob.id), 'keep-this-device')
    await syncOk(deviceB)
    await syncOk(db)
    expect((await db.contacts.get(bob.id))?.interests).toBe('Chess, jazz')
    expect(await deviceB.syncConflicts.count()).toBe(0)
  })

  it('an interaction whose contact is unknown is set aside, then arrives once the contact is there', async () => {
    const record = {
      id: 'i-1', contactId: 'c-later', occurredStart: '2026-11-10T09:00:00.000Z', timezone: 'Europe/Paris', text: 'Call',
      createdAt: '2026-11-10T09:00:00.000Z', updatedAt: '2026-11-10T09:00:00.000Z', deletedAt: null,
    }
    const encrypted = await encryptRecord(dataKey, { userId: USER, collection: 'contactInteractions', recordId: 'i-1', revision: 1, keyVersion: 1 }, record)
    if (encrypted.status !== 'ok') throw new Error('encrypt failed')
    server.inject({ collection: 'contactInteractions', recordId: 'i-1', revision: 1, keyVersion: 1, ...encrypted })

    expect((await syncOk(deviceB)).problems).toBe(1)
    expect(await deviceB.syncConflicts.get('contactInteractions:i-1')).toMatchObject({
      kind: 'invalid-remote', reason: 'its contact is neither in the backup nor on this device',
    })

    // The contact is uploaded later (e.g. by a device that was offline).
    const contact = {
      id: 'c-later', name: 'Later', description: null, education: null, address: null, birthday: null, interests: null, dislikes: null,
      externalPhoneId: null, createdAt: '2026-11-10T08:00:00.000Z', updatedAt: '2026-11-10T08:00:00.000Z', deletedAt: null,
    }
    const encryptedContact = await encryptRecord(dataKey, { userId: USER, collection: 'contacts', recordId: 'c-later', revision: 1, keyVersion: 1 }, contact)
    if (encryptedContact.status !== 'ok') throw new Error('encrypt failed')
    server.inject({ collection: 'contacts', recordId: 'c-later', revision: 1, keyVersion: 1, ...encryptedContact })

    await syncOk(deviceB)
    expect(await deviceB.contactInteractions.get('i-1')).toMatchObject({ text: 'Call', syncStatus: 'synced' })
    expect(await deviceB.syncConflicts.count()).toBe(0)
  })

  it('a contact that breaks the rules (e.g. impossible birthday) is listed, not applied', async () => {
    const record = {
      id: 'c-bad', name: 'Bad', description: null, education: null, address: null, birthday: '1990-02-30', interests: null, dislikes: null,
      externalPhoneId: null, createdAt: '2026-11-10T08:00:00.000Z', updatedAt: '2026-11-10T08:00:00.000Z', deletedAt: null,
    }
    const encrypted = await encryptRecord(dataKey, { userId: USER, collection: 'contacts', recordId: 'c-bad', revision: 1, keyVersion: 1 }, record)
    if (encrypted.status !== 'ok') throw new Error('encrypt failed')
    server.inject({ collection: 'contacts', recordId: 'c-bad', revision: 1, keyVersion: 1, ...encrypted })

    expect((await syncOk(deviceB)).problems).toBe(1)
    expect(await deviceB.contacts.count()).toBe(0)
    expect(await deviceB.syncConflicts.get('contacts:c-bad')).toMatchObject({ reason: 'birthday is not a real calendar date' })
  })
})

describe('stored problems are retried with the current rules', () => {
  /** What an older app version would have stored for a record it could not use. */
  async function parkProblem(device: PersonalDataDatabase, collection: 'habits' | 'externalSamples', recordId: string, raw: object, revision: number) {
    await device.syncConflicts.put({
      id: conflictId(collection, recordId),
      kind: 'invalid-remote',
      collection,
      recordId,
      remoteRecord: raw,
      remoteRevision: revision,
      reason: 'imported samples cannot be synchronised yet',
      detectedAt: '2026-11-10T00:00:00.000Z',
    })
  }

  /** As if the device had already downloaded everything on the server. */
  async function markAllPulled(device: PersonalDataDatabase) {
    const state = await device.syncState.get('current')
    const latest = Math.max(0, ...server.rows().map((row) => row.serverSeq))
    await device.syncState.put({ ...state!, lastServerSeq: latest })
  }

  it('a record an older version set aside arrives after the update, and leaves the problem list', async () => {
    const day = screenTimeSample('day-9')
    await db.externalSamples.add(day)
    await syncOk(db)
    await parkProblem(deviceB, 'externalSamples', 'day-9', uploadContent(day), 1)
    await markAllPulled(deviceB)

    const result = await syncOk(deviceB)

    expect(result.applied).toBe(1)
    expect(await deviceB.externalSamples.get('day-9')).toMatchObject({ value: 4380, syncStatus: 'synced', revision: 1, syncedRevision: 1 })
    expect(await deviceB.syncConflicts.count()).toBe(0)
  })

  it('a record that still breaks the rules stays listed, unchanged, round after round', async () => {
    const bad = screenTimeSample('bad-day', '2026-11-09', { value: 100_000 })
    await parkProblem(deviceB, 'externalSamples', 'bad-day', uploadContent(bad), 1)
    const before = await deviceB.syncConflicts.get(conflictId('externalSamples', 'bad-day'))

    await syncOk(deviceB)
    await syncOk(deviceB)

    expect(await deviceB.externalSamples.count()).toBe(0)
    expect(await deviceB.syncConflicts.get(conflictId('externalSamples', 'bad-day'))).toEqual(before)
  })

  it('a problem made outdated by a newer version already on the device is removed', async () => {
    const { water } = await syncedPair()
    const local = (await deviceB.habits.get(water.id))!
    await parkProblem(deviceB, 'habits', water.id, uploadContent({ ...local, name: 'Old name' }), local.syncedRevision!)

    await syncOk(deviceB)

    expect(await deviceB.syncConflicts.count()).toBe(0)
    expect((await deviceB.habits.get(water.id))?.name).toBe('Water')
  })

  it('an unedited copy that was only marked "conflict" by the problem takes the server version', async () => {
    const { water } = await syncedPair()
    const local = (await deviceB.habits.get(water.id))!
    // Recording the problem had marked the untouched copy "conflict".
    await deviceB.habits.put({ ...local, syncStatus: 'conflict' })
    await parkProblem(deviceB, 'habits', water.id, uploadContent({ ...local, name: 'Water (renamed)' }), local.syncedRevision! + 1)

    await syncOk(deviceB)

    expect(await deviceB.habits.get(water.id)).toMatchObject({ name: 'Water (renamed)', syncStatus: 'synced', syncedRevision: local.syncedRevision! + 1 })
    expect(await deviceB.syncConflicts.count()).toBe(0)
  })

  it('a copy edited on this device becomes an ordinary conflict: nothing is overwritten', async () => {
    const { water } = await syncedPair()
    await editOnB('habits', water.id, { name: 'Water (edited here)' })
    const local = (await deviceB.habits.get(water.id))!
    await deviceB.habits.put({ ...local, syncStatus: 'conflict' })
    await parkProblem(deviceB, 'habits', water.id, uploadContent({ ...local, name: 'Water (from server)' }), local.syncedRevision! + 1)

    const result = await syncOk(deviceB)

    expect(result.conflicts).toBe(1)
    expect((await deviceB.habits.get(water.id))?.name).toBe('Water (edited here)')
    expect(await deviceB.syncConflicts.get(conflictId('habits', water.id))).toMatchObject({
      kind: 'conflict',
      remoteRecord: expect.objectContaining({ name: 'Water (from server)' }),
    })
  })

  it('a problem without a readable copy (could not be decrypted) is left alone', async () => {
    await deviceB.syncConflicts.put({
      id: conflictId('habits', 'unreadable'),
      kind: 'invalid-remote',
      collection: 'habits',
      recordId: 'unreadable',
      remoteRecord: null,
      remoteRevision: 1,
      reason: 'could not be decrypted',
      detectedAt: '2026-11-10T00:00:00.000Z',
    })

    await syncOk(deviceB)

    expect(await deviceB.syncConflicts.get(conflictId('habits', 'unreadable'))).toMatchObject({ reason: 'could not be decrypted' })
  })
})

describe('failures', () => {
  it('a network failure while uploading loses nothing; the next round finishes', async () => {
    await seedDeviceA()
    let pushes = 0
    server.beforePush = () => {
      pushes += 1
      if (pushes === 4) throw new SyncServerError('network', 'connection lost')
    }

    const failed = (await sync(db)) as Extract<SyncRoundResult, { status: 'failed' }>
    expect(failed).toMatchObject({ status: 'failed', stage: 'push', kind: 'network', pushed: 3 })
    expect(server.rows()).toHaveLength(3)
    const pending = [
      ...(await db.habits.toArray()),
      ...(await db.entries.toArray()),
      ...(await db.sleepSessions.toArray()),
      ...(await db.settings.toArray()),
    ].filter((r) => r.syncStatus === 'pending')
    expect(pending).toHaveLength(6)

    expect((await syncOk(db)).pushed).toBe(6)
    expect(server.rows()).toHaveLength(9)
  })

  it('a network failure while downloading changes nothing on the device', async () => {
    await seedDeviceA()
    await syncOk(db)
    const offline = { ...server, pullChanges: async () => Promise.reject(new SyncServerError('network', 'down')) }

    const result = await runSyncRound({ db: deviceB, server: offline })

    expect(result).toMatchObject({ status: 'failed', stage: 'pull', kind: 'network' })
    expect(await deviceB.habits.count()).toBe(0)
    expect((await deviceB.syncState.get('current'))?.lastServerSeq).toBe(0)
    expect((await syncOk(deviceB)).applied).toBe(9)
  })

  it('a record the server refuses is reported; the others are still uploaded', async () => {
    const water = await createHabit({ name: 'Water', type: 'number', unit: 'ml' })
    await createHabit({ name: 'Gym', type: 'checkbox' })
    server.beforePush = (request) => {
      if (request.recordId === water.id) throw new SyncServerError('server', 'refused')
    }

    const result = await syncOk(db)

    expect(result.pushed).toBe(1)
    expect(result.notPushed).toEqual([{ collection: 'habits', recordId: water.id, reason: 'refused' }])
    expect((await db.habits.get(water.id))?.syncStatus).toBe('pending')
  })

  it('a changed record the server no longer has (cloud data deleted) is uploaded again', async () => {
    const { morning } = await syncedPair()
    server.clear()
    await updateEntry(morning.id, { comment: 'After the wipe' })

    expect((await syncOk(db)).pushed).toBe(1)
    expect(server.rows().map((r) => r.recordId)).toEqual([morning.id])
    expect(await db.entries.get(morning.id)).toMatchObject({ syncStatus: 'synced', syncedRevision: 2 })
  })
})
