/**
 * Linking this device to a sync account (docs/SYNC_DESIGN.md §7).
 *
 * - First device: createKeys() makes the data key and recovery key in
 *   memory; nothing is uploaded until the user confirms they saved the
 *   recovery key (completeFirstDeviceSetup).
 * - Other devices: unlock the stored key with the passphrase or the
 *   recovery key (unlockThisDevice).
 * - Unlinking (sign out, cloud data deleted): removes the key and sync
 *   state from this device and marks every record "pending, never
 *   synchronised", so linking again re-checks everything with the server.
 *   No data is deleted.
 */

import type { PersonalDataDatabase } from '../database/db'
import { messages } from '../i18n'
import {
  changePassphrase,
  createKeys,
  unlockDataKey,
  type ChangePassphraseResult,
  type CreatedKeys,
  type Secret,
  type UnlockResult,
} from './crypto'
import type { SyncServer } from './server'

const SYNCED_TABLES = ['habits', 'entries', 'sleepSessions', 'externalSamples', 'settings', 'contacts', 'contactInteractions'] as const

export async function linkDevice(
  db: PersonalDataDatabase,
  link: { userId: string; dataKey: CryptoKey; keyVersion: number },
  now = new Date(),
): Promise<void> {
  await db.syncState.put({
    id: 'current',
    userId: link.userId,
    lastServerSeq: 0,
    keyVersion: link.keyVersion,
    dataKey: link.dataKey,
    linkedAt: now.toISOString(),
  })
}

export async function unlinkDevice(db: PersonalDataDatabase): Promise<void> {
  const tables = SYNCED_TABLES.map((name) => db.table(name))
  await db.transaction('rw', [...tables, db.syncState, db.syncConflicts], async () => {
    await db.syncState.clear()
    await db.syncConflicts.clear()
    for (const table of tables) {
      await table
        .filter((record) => record.syncStatus !== 'pending' || record.syncedRevision !== null)
        .modify({ syncStatus: 'pending', syncedRevision: null })
    }
  })
}

/** Number of local changes not yet confirmed by the server. */
export async function countPendingChanges(db: PersonalDataDatabase): Promise<number> {
  let total = 0
  for (const name of SYNCED_TABLES) {
    total += await db.table(name).where('syncStatus').equals('pending').count()
  }
  return total
}

/** First device, step 1: keys in memory only (shown to the user). */
export function prepareFirstDeviceKeys(passphrase: string, options?: { iterations?: number }): Promise<CreatedKeys> {
  return createKeys(passphrase, options)
}

/** First device, step 2 (after the user saved the recovery key). */
export async function completeFirstDeviceSetup(
  db: PersonalDataDatabase,
  server: SyncServer,
  userId: string,
  keys: CreatedKeys,
): Promise<void> {
  await server.createKeyEnvelope(keys.envelope)
  // A fresh account: every local record must be uploaded.
  await unlinkDevice(db)
  await linkDevice(db, { userId, dataKey: keys.dataKey, keyVersion: keys.envelope.keyVersion })
}

export type UnlockDeviceResult = UnlockResult | { status: 'no-key' }

/** Another device: opens the account's key and links this device. */
export async function unlockThisDevice(
  db: PersonalDataDatabase,
  server: SyncServer,
  userId: string,
  secret: Secret,
): Promise<UnlockDeviceResult> {
  const envelope = await server.getKeyEnvelope()
  if (!envelope) return { status: 'no-key' }

  const result = await unlockDataKey(envelope, secret)
  if (result.status !== 'ok') return result

  // Records from before (another account, or an old link) are re-checked.
  await unlinkDevice(db)
  await linkDevice(db, { userId, dataKey: result.dataKey, keyVersion: envelope.keyVersion })
  return result
}

export type RemoveLocalDataResult =
  | { status: 'removed' }
  | { status: 'blocked'; reasons: string[] }

/**
 * "Sign out and remove the data from this browser" (user decision
 * 2026-11-10). Removes every record from this device ONLY if all of it is
 * safely on the server: the device is linked, nothing is waiting to be
 * sent, nothing is in conflict, and no stopwatch is running (running
 * stopwatches are never synchronised). Checks and removal happen in one
 * transaction, so nothing can change in between. Call it after a
 * successful sync round.
 */
export async function removeLocalDataIfSafe(db: PersonalDataDatabase): Promise<RemoveLocalDataResult> {
  const synced = SYNCED_TABLES.map((name) => db.table(name))
  const everything = [...synced, db.activeTimers, db.syncState, db.syncConflicts]

  return db.transaction('rw', everything, async () => {
    const reasons: string[] = []

    if ((await db.syncState.count()) === 0) {
      reasons.push(messages().syncText.notLinked)
    }

    let pending = 0
    let conflicts = 0
    for (const table of synced) {
      pending += await table.where('syncStatus').equals('pending').count()
      conflicts += await table.where('syncStatus').equals('conflict').count()
    }
    if (pending > 0) {
      reasons.push(messages().syncText.pending(pending))
    }
    if (conflicts > 0) {
      reasons.push(messages().syncText.waiting(conflicts))
    }

    const timers = await db.activeTimers.count()
    if (timers > 0) {
      reasons.push(messages().syncText.timers(timers))
    }

    if (reasons.length > 0) return { status: 'blocked', reasons }

    for (const table of everything) await table.clear()
    return { status: 'removed' }
  })
}

export type ChangeSyncPassphraseResult = ChangePassphraseResult | { status: 'no-key' }

/**
 * Sets a new passphrase, unlocking with the current passphrase or the
 * recovery key ("forgot my passphrase"). Only the passphrase wrapping on
 * the server changes; every device stays linked and nothing is
 * re-encrypted. Other devices use the new passphrase the next time they
 * unlock.
 */
export async function changeSyncPassphrase(
  server: SyncServer,
  userId: string,
  current: Secret,
  newPassphrase: string,
  options?: { iterations?: number },
): Promise<ChangeSyncPassphraseResult> {
  const envelope = await server.getKeyEnvelope()
  if (!envelope) return { status: 'no-key' }

  const result = await changePassphrase(envelope, current, newPassphrase, options)
  if (result.status !== 'ok') return result

  await server.updatePassphraseWrap(userId, result.envelope)
  return result
}

/**
 * "Lost both my passphrase and my recovery key": the cloud copy cannot be
 * opened by anyone, so it is deleted (key and records) and this device is
 * unlinked. All data on this and other devices is kept; sync can then be
 * set up again with a new passphrase, and other devices re-join with it.
 */
export async function startOver(db: PersonalDataDatabase, server: SyncServer): Promise<number> {
  const deleted = await server.deleteCloudData()
  await unlinkDevice(db)
  return deleted
}
