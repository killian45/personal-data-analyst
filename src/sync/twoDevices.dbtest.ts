// End-to-end: the sync engine against the LOCAL Supabase stack
// ("npm run db:start", then "npm run test:db"). Not part of "npm test".
import 'fake-indexeddb/auto'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'

import { PersonalDataDatabase } from '../database/db'
import { nextSyncFields } from '../database/sync'
import type { Entry, Habit, SettingRecord, SleepSession } from '../database/types'
import { buildScreenTimeDedupeKey } from '../screenTime/screenTime'
import { locationSamples } from '../location/testLocation'
import { screenTimeSample } from '../screenTime/testScreenTime'
import { createKeys } from './crypto'
import { conflictId, resolveConflict, runSyncRound } from './engine'
import { createSupabaseSyncServer, type SyncServer } from './server'

declare module 'vitest' {
  export interface ProvidedContext {
    supabase: { url: string; publicKey: string }
  }
}

const T = '2026-11-10T08:00:00.000Z'

function client(): SupabaseClient {
  const { url, publicKey } = inject('supabase')
  return createClient(url, publicKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}

async function signUp(): Promise<{ id: string; email: string; password: string; server: SyncServer; supabase: SupabaseClient }> {
  const supabase = client()
  const email = `sync-e2e-${crypto.randomUUID()}@example.com`
  const password = crypto.randomUUID()
  const { data, error } = await supabase.auth.signUp({ email, password })
  if (error || !data.user) throw error ?? new Error('no user')
  return { id: data.user.id, email, password, supabase, server: createSupabaseSyncServer(supabase) }
}

async function signIn(email: string, password: string): Promise<SyncServer> {
  const supabase = client()
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
  return createSupabaseSyncServer(supabase)
}

async function device(name: string, userId: string, dataKey: CryptoKey) {
  const db = new PersonalDataDatabase(`${name}-${crypto.randomUUID()}`)
  await db.open()
  await db.syncState.put({ id: 'current', userId, lastServerSeq: 0, keyVersion: 1, dataKey, linkedAt: T })
  return db
}

const habit: Habit = {
  id: crypto.randomUUID(), name: 'Water', type: 'number', unit: 'ml', labelOptions: null, dailyAggregation: 'sum',
  target: null, color: '#2563eb', archived: false, sortOrder: 0, syncStatus: 'pending', revision: 1,
  syncedRevision: null, createdAt: T, updatedAt: T, deletedAt: null,
} as Habit
const entry: Entry = {
  id: crypto.randomUUID(), habitId: habit.id, habitType: 'number', occurredStart: T, occurredEnd: null,
  timezone: 'Europe/Paris', value: 500, comment: 'Morning', source: 'manual', externalId: null,
  syncStatus: 'pending', revision: 1, syncedRevision: null, createdAt: T, updatedAt: T, deletedAt: null,
} as Entry
const setting: SettingRecord = {
  key: 'displayTimezone', value: 'Europe/Paris', updatedAt: T, deletedAt: null,
  syncStatus: 'pending', revision: 1, syncedRevision: null,
}
const night: SleepSession = {
  id: crypto.randomUUID(), source: 'health_connect', externalId: 'hc-e2e', sourceApp: 'com.example.sleep',
  dedupeKey: 'health_connect:id:hc-e2e', startUtc: '2026-11-07T22:00:00.000Z', endUtc: '2026-11-08T06:00:00.000Z',
  timezone: null, startOffsetMinutes: 60, endOffsetMinutes: 60,
  stages: [{ start: '2026-11-07T22:10:00.000Z', end: '2026-11-07T23:00:00.000Z', stage: 'deep' }],
  reportedSleepMs: null, comment: null, importedAt: T, metadata: { recordingMethod: 2 },
  syncStatus: 'pending', revision: 1, syncedRevision: null, createdAt: T, updatedAt: T, deletedAt: null,
} as SleepSession

async function contents(db: PersonalDataDatabase) {
  return {
    habits: await db.habits.toArray(),
    entries: await db.entries.toArray(),
    sleepSessions: await db.sleepSessions.toArray(),
    settings: await db.settings.toArray(),
    externalSamples: await db.externalSamples.toArray(),
    contacts: await db.contacts.toArray(),
    contactInteractions: await db.contactInteractions.toArray(),
  }
}

async function editEntry(db: PersonalDataDatabase, changes: Partial<Entry>) {
  const current = (await db.entries.get(entry.id)) as Entry
  await db.entries.put({ ...current, ...changes, ...nextSyncFields(current), updatedAt: new Date().toISOString() } as Entry)
}

describe('sync engine with the real (local) Supabase', () => {
  let a: PersonalDataDatabase
  let b: PersonalDataDatabase
  let e: PersonalDataDatabase
  let serverA: SyncServer
  let serverB: SyncServer
  let serverE: SyncServer
  let alice: Awaited<ReturnType<typeof signUp>>

  beforeAll(async () => {
    alice = await signUp()
    const eve = await signUp()
    serverA = alice.server
    serverB = await signIn(alice.email, alice.password)
    serverE = eve.server

    const aliceKeys = await createKeys('correct horse battery staple', { iterations: 100_000 })
    const eveKeys = await createKeys('another long passphrase', { iterations: 100_000 })
    await serverA.createKeyEnvelope(aliceKeys.envelope)
    await serverE.createKeyEnvelope(eveKeys.envelope)
    const dataKey = aliceKeys.dataKey
    const eveKey = eveKeys.dataKey
    a = await device('a', alice.id, dataKey)
    b = await device('b', alice.id, dataKey)
    e = await device('e', eve.id, eveKey)

    await a.habits.add(habit)
    await a.entries.add(entry)
    await a.settings.add(setting)
    await a.sleepSessions.add(night)
    // Screen time from both sources (App Usage file and the phone).
    await a.externalSamples.add(screenTimeSample('st-file-9', '2026-11-09'))
    await a.externalSamples.add(screenTimeSample('st-phone-9', '2026-11-09', {
      source: 'android_usage',
      sourceApp: 'Android (Usage access)',
      dedupeKey: buildScreenTimeDedupeKey('android_usage', '2026-11-09'),
      metadata: { format: 1, localDate: '2026-11-09', apps: [{ name: 'Chat', package: 'com.chat', seconds: 4380, opens: null }] },
    }))
    // Location: one visit and one movement (made-up coordinates).
    await a.externalSamples.bulkAdd(locationSamples())
    // Personal CRM: a contact (imported from a phone) and one interaction.
    await a.contacts.add({
      id: 'c-amelie', name: 'Amélie', description: 'Met at university', education: null, address: '12 rue X\n75011 Paris',
      birthday: '--05-17', interests: 'Jazz', dislikes: null, externalPhoneId: 'lookup-1',
      syncStatus: 'pending', revision: 1, syncedRevision: null,
      createdAt: '2026-11-12T10:00:00.000Z', updatedAt: '2026-11-12T10:00:00.000Z', deletedAt: null,
    })
    await a.contactInteractions.add({
      id: 'i-lunch', contactId: 'c-amelie', occurredStart: '2026-11-12T11:30:00.000Z', timezone: 'Europe/Paris', text: 'Lunch',
      syncStatus: 'pending', revision: 1, syncedRevision: null,
      createdAt: '2026-11-12T12:00:00.000Z', updatedAt: '2026-11-12T12:00:00.000Z', deletedAt: null,
    })
  })

  afterAll(async () => {
    for (const db of [a, b, e]) {
      db.close()
      await db.delete()
    }
  })

  it('device A uploads, device B receives an exact copy', async () => {
    expect(await runSyncRound({ db: a, server: serverA })).toMatchObject({ status: 'ok', pushed: 10 })
    expect(await runSyncRound({ db: b, server: serverB })).toMatchObject({ status: 'ok', applied: 10, problems: 0 })
    expect(await contents(b)).toEqual(await contents(a))
  })

  it('another account sees nothing', async () => {
    expect(await runSyncRound({ db: e, server: serverE })).toMatchObject({ status: 'ok', pulled: 0 })
    expect(await serverE.pullChanges(0, 100)).toEqual([])
  })

  it('an edit made on B reaches A', async () => {
    await editEntry(b, { comment: 'Edited on B' })
    expect(await runSyncRound({ db: b, server: serverB })).toMatchObject({ status: 'ok', pushed: 1 })
    expect(await runSyncRound({ db: a, server: serverA })).toMatchObject({ status: 'ok', applied: 1 })
    expect((await a.entries.get(entry.id))?.comment).toBe('Edited on B')
  })

  it('a conflict keeps both versions and resolves on both devices', async () => {
    await editEntry(a, { comment: 'From A' })
    await editEntry(b, { comment: 'From B' })
    await runSyncRound({ db: a, server: serverA })

    expect(await runSyncRound({ db: b, server: serverB })).toMatchObject({ status: 'ok', conflicts: 1, pushed: 0 })
    expect((await b.entries.get(entry.id))?.comment).toBe('From B')

    await resolveConflict(b, conflictId('entries', entry.id), 'keep-this-device')
    expect(await runSyncRound({ db: b, server: serverB })).toMatchObject({ status: 'ok', pushed: 1 })
    expect(await runSyncRound({ db: a, server: serverA })).toMatchObject({ status: 'ok', applied: 1 })
    expect(await contents(a)).toEqual(await contents(b))
  })

  it('records re-marked as never synced (e.g. restored) match the server through push_record conflicts', async () => {
    for (const table of ['habits', 'entries', 'sleepSessions', 'settings', 'externalSamples', 'contacts', 'contactInteractions'] as const) {
      const rows = await b.table(table).toArray()
      await b.table(table).bulkPut(rows.map((r) => ({ ...r, syncStatus: 'pending', syncedRevision: null })))
    }
    expect(await runSyncRound({ db: b, server: serverB })).toMatchObject({
      status: 'ok', conflicts: 0, problems: 0, pushed: 0, applied: 10,
    })
    expect(await contents(b)).toEqual(await contents(a))
  })

  it('after the cloud copy is deleted, a changed record is uploaded again', async () => {
    const { error } = await alice.supabase.from('sync_records').delete().eq('record_id', entry.id)
    expect(error).toBeNull()
    await editEntry(a, { comment: 'After deletion' })

    expect(await runSyncRound({ db: a, server: serverA })).toMatchObject({ status: 'ok', pushed: 1 })
    expect(await runSyncRound({ db: b, server: serverB })).toMatchObject({ status: 'ok', applied: 1 })
    expect((await b.entries.get(entry.id))?.comment).toBe('After deletion')
  })

  it('reads back the stored key envelope byte for byte', async () => {
    const envelope = await serverB.getKeyEnvelope()
    expect(envelope?.salt).toHaveLength(16)
    expect(envelope?.wrappedKeyPass).toHaveLength(40)
    expect(envelope?.iterations).toBe(100_000)
  })

  it('a new passphrase is stored on the server and opens the key on another device', async () => {
    const { changeSyncPassphrase } = await import('./device')
    const before = await serverB.getKeyEnvelope()
    expect(
      await changeSyncPassphrase(
        serverA,
        alice.id,
        { kind: 'passphrase', passphrase: 'correct horse battery staple' },
        'a new passphrase for alice',
        { iterations: 100_000 },
      ),
    ).toMatchObject({ status: 'ok' })

    const after = await serverB.getKeyEnvelope()
    expect(after?.salt).not.toEqual(before?.salt)
    expect(after?.wrappedKeyRec).toEqual(before?.wrappedKeyRec)
    const { unlockDataKey } = await import('./crypto')
    expect((await unlockDataKey(after!, { kind: 'passphrase', passphrase: 'a new passphrase for alice' })).status).toBe('ok')
    // Another account cannot overwrite alice's key.
    await expect(serverE.updatePassphraseWrap(alice.id, after!)).rejects.toThrow('no encryption key')
  })

  it('deleting the cloud data unlinks the other device on its next sync', async () => {
    expect(await serverA.deleteCloudData()).toBe(10) // 4 records + 2 screen-time days + 2 location segments + contact + interaction
    expect(await runSyncRound({ db: b, server: serverB })).toEqual({ status: 'cloud-deleted' })
    expect(await b.syncState.count()).toBe(0)
    expect(await b.entries.count()).toBe(1)
    expect(await serverB.pullChanges(0, 100)).toEqual([])
  })
})
