import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { db, PersonalDataDatabase } from '../database/db'
import { createHabit } from '../database/habits'
import { startStopwatch } from '../database/stopwatches'
import { saveDisplayTimezone } from '../settings/displayTimezone'
import { decryptRecord, encryptRecord, MIN_PBKDF2_ITERATIONS } from './crypto'
import {
  changeSyncPassphrase,
  completeFirstDeviceSetup,
  countPendingChanges,
  linkDevice,
  prepareFirstDeviceKeys,
  removeLocalDataIfSafe,
  startOver,
  unlinkDevice,
  unlockThisDevice,
} from './device'
import { runSyncRound } from './engine'
import { createMemoryServer, type MemoryServer } from './testing/memoryServer'

const USER = 'user-1'
const PASSPHRASE = 'correct horse battery staple'
const FAST = { iterations: MIN_PBKDF2_ITERATIONS }
let server: MemoryServer

beforeEach(async () => {
  await db.delete()
  await db.open()
  server = createMemoryServer(USER, null)
})

afterEach(async () => {
  db.close()
  await db.delete()
})

describe('first device setup', () => {
  it('uploads nothing until the user confirms, then stores the key and links the device', async () => {
    await createHabit({ name: 'Water', type: 'number', unit: 'ml' })

    const keys = await prepareFirstDeviceKeys(PASSPHRASE, FAST)
    expect(server.envelope).toBeNull()
    expect(await db.syncState.count()).toBe(0)

    await completeFirstDeviceSetup(db, server, USER, keys)

    expect(server.envelope).toEqual(keys.envelope)
    expect(await db.syncState.get('current')).toMatchObject({ userId: USER, lastServerSeq: 0, keyVersion: 1 })
    expect(await countPendingChanges(db)).toBe(1)
    expect(await runSyncRound({ db, server })).toMatchObject({ status: 'ok', pushed: 1 })
  })

  it('refuses when the account already has a key (another device was set up first)', async () => {
    const first = await prepareFirstDeviceKeys(PASSPHRASE, FAST)
    await completeFirstDeviceSetup(db, server, USER, first)
    await db.syncState.clear()

    const second = await prepareFirstDeviceKeys('a different passphrase', FAST)
    await expect(completeFirstDeviceSetup(db, server, USER, second)).rejects.toThrow('a key already exists')
    expect(server.envelope).toEqual(first.envelope)
    expect(await db.syncState.count()).toBe(0)
  })
})

describe('unlocking another device', () => {
  async function accountWithKey() {
    const keys = await prepareFirstDeviceKeys(PASSPHRASE, FAST)
    server.envelope = keys.envelope
    return keys
  }

  it('with the passphrase: links the device with the same data key', async () => {
    const keys = await accountWithKey()

    const result = await unlockThisDevice(db, server, USER, { kind: 'passphrase', passphrase: PASSPHRASE })

    expect(result.status).toBe('ok')
    const state = await db.syncState.get('current')
    const context = { userId: USER, collection: 'habits' as const, recordId: 'x', revision: 1, keyVersion: 1 }
    const encrypted = await encryptRecord(keys.dataKey, context, { hello: 'world' })
    if (encrypted.status !== 'ok' || !state) throw new Error('setup failed')
    expect(await decryptRecord(state.dataKey, context, encrypted.ciphertext, encrypted.iv)).toEqual({
      status: 'ok',
      record: { hello: 'world' },
    })
  })

  it('with the recovery key', async () => {
    const keys = await accountWithKey()
    const result = await unlockThisDevice(db, server, USER, { kind: 'recoveryKey', recoveryKey: keys.recoveryKey })
    expect(result.status).toBe('ok')
    expect(await db.syncState.count()).toBe(1)
  })

  it('reports a wrong passphrase or a mistyped recovery key and links nothing', async () => {
    const keys = await accountWithKey()

    expect(await unlockThisDevice(db, server, USER, { kind: 'passphrase', passphrase: 'not the passphrase' })).toEqual({
      status: 'wrong-secret',
    })
    const typo = (keys.recoveryKey[0] === '0' ? '1' : '0') + keys.recoveryKey.slice(1)
    expect(await unlockThisDevice(db, server, USER, { kind: 'recoveryKey', recoveryKey: typo })).toEqual({
      status: 'invalid-recovery-key',
      reason: 'checksum',
    })
    expect(await db.syncState.count()).toBe(0)
  })

  it('reports when the account has no key yet', async () => {
    expect(await unlockThisDevice(db, server, USER, { kind: 'passphrase', passphrase: PASSPHRASE })).toEqual({
      status: 'no-key',
    })
  })
})

describe('unlinking', () => {
  it('removes the key and sync state, keeps all data, and marks every record never synchronised', async () => {
    const keys = await prepareFirstDeviceKeys(PASSPHRASE, FAST)
    await completeFirstDeviceSetup(db, server, USER, keys)
    const habit = await createHabit({ name: 'Water', type: 'number', unit: 'ml' })
    await saveDisplayTimezone('Asia/Tokyo')
    await runSyncRound({ db, server })
    expect(await countPendingChanges(db)).toBe(0)
    await db.syncConflicts.put({
      id: 'habits:x', kind: 'conflict', collection: 'habits', recordId: 'x',
      remoteRecord: {}, remoteRevision: 2, detectedAt: '2026-11-10T00:00:00.000Z',
    })

    await unlinkDevice(db)

    expect(await db.syncState.count()).toBe(0)
    expect(await db.syncConflicts.count()).toBe(0)
    expect(await db.habits.get(habit.id)).toMatchObject({ name: 'Water', syncStatus: 'pending', syncedRevision: null })
    expect(await db.settings.get('displayTimezone')).toMatchObject({ value: 'Asia/Tokyo', syncedRevision: null })
    expect(await countPendingChanges(db)).toBe(2)
  })

  it('linkDevice starts from the beginning of the server history', async () => {
    const keys = await prepareFirstDeviceKeys(PASSPHRASE, FAST)
    await linkDevice(db, { userId: USER, dataKey: keys.dataKey, keyVersion: 1 }, new Date('2026-11-10T09:00:00.000Z'))
    expect(await db.syncState.get('current')).toMatchObject({
      lastServerSeq: 0,
      linkedAt: '2026-11-10T09:00:00.000Z',
    })
  })
})

describe('sync round safety checks', () => {
  it('after the cloud data was deleted elsewhere, the device unlinks itself and uploads nothing', async () => {
    const keys = await prepareFirstDeviceKeys(PASSPHRASE, FAST)
    await completeFirstDeviceSetup(db, server, USER, keys)
    await createHabit({ name: 'Water', type: 'number', unit: 'ml' })
    await runSyncRound({ db, server })

    await server.deleteCloudData()
    await createHabit({ name: 'Gym', type: 'checkbox' })

    expect(await runSyncRound({ db, server })).toEqual({ status: 'cloud-deleted' })
    expect(server.rows()).toEqual([])
    expect(await db.syncState.count()).toBe(0)
    expect(await db.habits.count()).toBe(2)
    expect(await countPendingChanges(db)).toBe(2)
  })

  it('stops when the account key version differs from this device', async () => {
    const keys = await prepareFirstDeviceKeys(PASSPHRASE, FAST)
    await completeFirstDeviceSetup(db, server, USER, keys)
    server.envelope = { ...keys.envelope, keyVersion: 2 }
    await createHabit({ name: 'Water', type: 'number', unit: 'ml' })

    expect(await runSyncRound({ db, server })).toEqual({ status: 'key-changed' })
    expect(server.rows()).toEqual([])
  })
})

describe('removing the data from this browser (sign out and remove)', () => {
  async function syncedDevice() {
    const keys = await prepareFirstDeviceKeys(PASSPHRASE, FAST)
    await completeFirstDeviceSetup(db, server, USER, keys)
    const habit = await createHabit({ name: 'Water', type: 'number', unit: 'ml' })
    await saveDisplayTimezone('Asia/Tokyo')
    await runSyncRound({ db, server })
    return habit
  }

  it('removes everything when all data is safely on the server', async () => {
    await syncedDevice()

    expect(await removeLocalDataIfSafe(db)).toEqual({ status: 'removed' })

    for (const table of db.tables) expect(await table.count(), table.name).toBe(0)
    expect(server.rows()).toHaveLength(2) // the server copy is untouched
  })

  it('refuses when changes have not been sent', async () => {
    await syncedDevice()
    await createHabit({ name: 'Gym', type: 'checkbox' })

    expect(await removeLocalDataIfSafe(db)).toEqual({
      status: 'blocked',
      reasons: ['1 change has not been sent to the server yet.'],
    })
    expect(await db.habits.count()).toBe(2)
  })

  it('refuses when a record is in conflict', async () => {
    const habit = await syncedDevice()
    const stored = await db.habits.get(habit.id)
    await db.habits.put({ ...stored!, syncStatus: 'conflict' })

    const result = await removeLocalDataIfSafe(db)
    expect(result).toMatchObject({ status: 'blocked', reasons: [expect.stringMatching(/waiting for your choice/)] })
  })

  it('refuses while a stopwatch is running (never synchronised)', async () => {
    await syncedDevice()
    const reading = await createHabit({ name: 'Reading', type: 'stopwatch' })
    await runSyncRound({ db, server })
    await startStopwatch(reading.id)

    const result = await removeLocalDataIfSafe(db)
    expect(result).toMatchObject({ status: 'blocked', reasons: [expect.stringMatching(/stopwatch is running/)] })
    expect(await db.activeTimers.count()).toBe(1)
  })

  it('refuses on a device that is not linked (its data may exist nowhere else)', async () => {
    await createHabit({ name: 'Water', type: 'number', unit: 'ml' })

    const result = await removeLocalDataIfSafe(db)
    expect(result).toMatchObject({ status: 'blocked' })
    if (result.status === 'blocked') expect(result.reasons[0]).toMatch(/not linked/)
    expect(await db.habits.count()).toBe(1)
  })
})

describe('changing the passphrase / forgotten passphrase', () => {
  const NEW = 'a brand new passphrase'

  async function syncedAccount() {
    const keys = await prepareFirstDeviceKeys(PASSPHRASE, FAST)
    await completeFirstDeviceSetup(db, server, USER, keys)
    await createHabit({ name: 'Water', type: 'number', unit: 'ml' })
    await runSyncRound({ db, server })
    return keys
  }

  async function otherDeviceUnlocks(secret: Parameters<typeof unlockThisDevice>[3]) {
    const other = new PersonalDataDatabase(`other-${crypto.randomUUID()}`)
    await other.open()
    const result = await unlockThisDevice(other, server, USER, secret)
    const sync = result.status === 'ok' ? await runSyncRound({ db: other, server }) : null
    const habits = await other.habits.count()
    other.close()
    await other.delete()
    return { status: result.status, sync, habits }
  }

  it('with the current passphrase: the new one works, the old one no longer does, data still readable', async () => {
    await syncedAccount()

    expect(await changeSyncPassphrase(server, USER, { kind: 'passphrase', passphrase: PASSPHRASE }, NEW, FAST)).toMatchObject({
      status: 'ok',
    })

    expect((await otherDeviceUnlocks({ kind: 'passphrase', passphrase: PASSPHRASE })).status).toBe('wrong-secret')
    expect(await otherDeviceUnlocks({ kind: 'passphrase', passphrase: NEW })).toMatchObject({
      status: 'ok',
      sync: { status: 'ok', applied: 1 },
      habits: 1,
    })
    // This device stays linked and keeps syncing.
    expect(await runSyncRound({ db, server })).toMatchObject({ status: 'ok' })
  })

  it('with the recovery key (passphrase forgotten); the recovery key keeps working', async () => {
    const keys = await syncedAccount()

    expect(
      await changeSyncPassphrase(server, USER, { kind: 'recoveryKey', recoveryKey: keys.recoveryKey }, NEW, FAST),
    ).toMatchObject({ status: 'ok' })

    expect((await otherDeviceUnlocks({ kind: 'passphrase', passphrase: NEW })).habits).toBe(1)
    expect((await otherDeviceUnlocks({ kind: 'recoveryKey', recoveryKey: keys.recoveryKey })).habits).toBe(1)
  })

  it('changes nothing when the current passphrase is wrong', async () => {
    await syncedAccount()
    const before = server.envelope

    expect(
      await changeSyncPassphrase(server, USER, { kind: 'passphrase', passphrase: 'not the passphrase' }, NEW, FAST),
    ).toEqual({ status: 'wrong-secret' })
    expect(server.envelope).toBe(before)
  })

  it('reports when the account has no key', async () => {
    expect(await changeSyncPassphrase(server, USER, { kind: 'passphrase', passphrase: PASSPHRASE }, NEW, FAST)).toEqual({
      status: 'no-key',
    })
  })
})

describe('starting over (passphrase and recovery key both lost)', () => {
  it('deletes the cloud copy, unlinks this device, keeps every local record', async () => {
    const keys = await prepareFirstDeviceKeys(PASSPHRASE, FAST)
    await completeFirstDeviceSetup(db, server, USER, keys)
    await createHabit({ name: 'Water', type: 'number', unit: 'ml' })
    await runSyncRound({ db, server })

    expect(await startOver(db, server)).toBe(1)

    expect(server.envelope).toBeNull()
    expect(server.rows()).toEqual([])
    expect(await db.syncState.count()).toBe(0)
    expect(await db.habits.count()).toBe(1)

    // Set up again with a new passphrase: everything is uploaded again.
    const fresh = await prepareFirstDeviceKeys('a completely new start', FAST)
    await completeFirstDeviceSetup(db, server, USER, fresh)
    expect(await runSyncRound({ db, server })).toMatchObject({ status: 'ok', pushed: 1 })
  })
})
