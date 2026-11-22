/**
 * Sync engine (docs/SYNC_DESIGN.md §5–6).
 *
 * One round:
 * 1. Pull: download every record changed since the last pull, decrypt and
 *    validate each with the same rules as backup restore, and merge them
 *    in ONE local transaction (habits before the entries that refer to
 *    them). The "last pulled" position advances in the same transaction.
 * 2. Push: encrypt and upload every "pending" record. A record is marked
 *    "synced" only after the server confirmed it. If the server holds
 *    another version, it is merged like a pulled record (usually a
 *    conflict for the user to resolve).
 *
 * Safety rules:
 * - Nothing local is overwritten unless only the server changed or both
 *   versions are equal. Otherwise the record becomes a conflict and the
 *   server version is kept in syncConflicts.
 * - Server records that cannot be decrypted or fail validation are never
 *   applied and never dropped: they are kept in syncConflicts as
 *   "invalid-remote" problems. Readable ones are re-checked at every round
 *   with the current rules (an app update may make them valid).
 * - Network or server failures stop the round. Everything already done is
 *   consistent; remaining changes stay "pending" for the next round.
 */

import type { Table } from 'dexie'
import { messages } from '../i18n'

import {
  validateContactInteractionRecord,
  validateContactRecord,
  validateEntryRecord,
  validateExternalSampleRecord,
  validateHabitRecord,
  validateSettingRecord,
  validateSleepSessionRecord,
} from '../backup/restore/validateRecords'
import type { PersonalDataDatabase } from '../database/db'
import type { ExternalSample, SleepSession, SyncConflictRecord, SyncFields, SyncStateRecord } from '../database/types'
import { decryptRecord, encryptRecord, type RecordContext } from './crypto'
import { unlinkDevice } from './device'
import { decideMerge, sameContent, uploadContent } from './merge'
import { SyncServerError, type RemoteRow, type SyncServer, type SyncServerErrorKind } from './server'
import type { SyncCollection } from './types'

/**
 * Habits before entries, contacts before interactions (each is validated
 * against the record it belongs to).
 */
export const APPLY_ORDER: readonly SyncCollection[] = [
  'settings',
  'habits',
  'entries',
  'sleepSessions',
  'externalSamples',
  'contacts',
  'contactInteractions',
]

const PULL_PAGE_SIZE = 500

type SyncedRecord = Record<string, unknown> & SyncFields

export interface SyncContext {
  db: PersonalDataDatabase
  server: SyncServer
  now?: () => Date
}

export interface SyncCounts {
  /** Records downloaded. */
  pulled: number
  /** Downloaded records stored on this device. */
  applied: number
  /** New conflicts waiting for the user. */
  conflicts: number
  /** New server records that could not be used (kept, listed). */
  problems: number
  /** Records uploaded and confirmed. */
  pushed: number
  /**
   * Server versions OLDER than the version this device already agreed on
   * with the server (security review 2026-11-12): refused, and this
   * device's newer version is uploaded again. Counted once per record
   * (when downloaded, or when found while uploading). Normally 0;
   * otherwise the server was restored from a backup or tampered with.
   */
  stale: number
}

export interface NotPushed {
  collection: SyncCollection
  recordId: string
  reason: string
}

export type SyncRoundResult =
  | ({ status: 'ok'; notPushed: NotPushed[] } & SyncCounts)
  | ({
      status: 'failed'
      stage: 'pull' | 'push'
      kind: SyncServerErrorKind | 'local'
      message: string
      notPushed: NotPushed[]
    } & SyncCounts)
  | { status: 'not-set-up' }
  | { status: 'signed-out' }
  | { status: 'account-mismatch' }
  /**
   * The account's key is gone from the server (cloud data deleted, here
   * or on another device). This device was unlinked: its data is kept and
   * marked "never synchronised"; nothing was uploaded.
   */
  | { status: 'cloud-deleted' }
  /** The account's key version differs from this device's (not supported yet). */
  | { status: 'key-changed' }
  | { status: 'busy' }

/** What identifies one server version of a record. */
type RowRef = Pick<RemoteRow, 'collection' | 'recordId' | 'revision'>

type Incoming =
  | { row: RowRef; status: 'decrypted'; raw: unknown }
  | { row: RowRef; status: 'unreadable'; reason: string }

type ApplyOutcome = 'skipped' | 'applied' | 'conflict' | 'problem' | 'stale'

function keyField(collection: SyncCollection): 'id' | 'key' {
  return collection === 'settings' ? 'key' : 'id'
}

export function conflictId(collection: SyncCollection, recordId: string): string {
  return `${collection}:${recordId}`
}

function tableOf(db: PersonalDataDatabase, collection: SyncCollection): Table<SyncedRecord, string> {
  return db.table(collection)
}

function syncTables(db: PersonalDataDatabase) {
  return [
    db.habits, db.entries, db.sleepSessions, db.externalSamples, db.settings,
    db.contacts, db.contactInteractions, db.syncConflicts, db.syncState,
  ]
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// --- pull ------------------------------------------------------------------

async function pullAll(server: SyncServer, afterSeq: number): Promise<RemoteRow[]> {
  // A record updated while paging can appear twice: keep its latest row.
  const latest = new Map<string, RemoteRow>()
  let after = afterSeq

  for (;;) {
    const page = await server.pullChanges(after, PULL_PAGE_SIZE)
    for (const row of page) {
      const key = conflictId(row.collection, row.recordId)
      const known = latest.get(key)
      if (!known || known.serverSeq < row.serverSeq) latest.set(key, row)
      after = Math.max(after, row.serverSeq)
    }
    if (page.length < PULL_PAGE_SIZE) break
  }

  return [...latest.values()]
}

async function decryptAll(state: SyncStateRecord, rows: RemoteRow[]): Promise<Incoming[]> {
  return Promise.all(
    rows.map(async (row): Promise<Incoming> => {
      if (row.keyVersion !== state.keyVersion) {
        return { row, status: 'unreadable', reason: 'encrypted with another key version' }
      }
      const context: RecordContext = {
        userId: state.userId,
        collection: row.collection,
        recordId: row.recordId,
        revision: row.revision,
        keyVersion: row.keyVersion,
      }
      const result = await decryptRecord(state.dataKey, context, row.ciphertext, row.iv)
      if (result.status === 'ok') return { row, status: 'decrypted', raw: result.record }
      return {
        row,
        status: 'unreadable',
        reason:
          result.status === 'unreadable'
            ? 'cannot be decrypted (wrong key, damaged or moved data)'
            : 'decrypted content is not valid',
      }
    }),
  )
}

type Validation = { status: 'ok'; record: SyncedRecord } | { status: 'invalid'; reason: string }

/** Validates a decrypted record with the app's rules (same as backup restore). */
async function validateIncoming(db: PersonalDataDatabase, row: RowRef, raw: unknown): Promise<Validation> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { status: 'invalid', reason: 'not a record' }
  }

  const withSync: Record<string, unknown> = {
    ...(raw as Record<string, unknown>),
    syncStatus: 'synced',
    revision: row.revision,
    syncedRevision: row.revision,
  }

  let record: SyncedRecord
  try {
    switch (row.collection) {
      case 'habits': {
        const { habit, notes } = validateHabitRecord(withSync)
        if (notes.length > 0) return { status: 'invalid', reason: notes.join(' ') }
        record = habit as unknown as SyncedRecord
        break
      }
      case 'entries': {
        const habit = await db.habits.get(String(withSync.habitId))
        record = validateEntryRecord(withSync, habit) as unknown as SyncedRecord
        break
      }
      case 'sleepSessions':
        record = validateSleepSessionRecord(withSync) as unknown as SyncedRecord
        break
      case 'settings':
        record = validateSettingRecord(withSync) as unknown as SyncedRecord
        break
      case 'externalSamples':
        record = validateExternalSampleRecord(withSync) as unknown as SyncedRecord
        break
      case 'contacts':
        record = validateContactRecord(withSync) as unknown as SyncedRecord
        break
      case 'contactInteractions': {
        const contact = await db.contacts.get(String(withSync.contactId))
        record = validateContactInteractionRecord(withSync, contact) as unknown as SyncedRecord
        break
      }
    }
  } catch (error) {
    return { status: 'invalid', reason: messageOf(error) }
  }

  if (record[keyField(row.collection)] !== row.recordId) {
    return { status: 'invalid', reason: 'the record does not match its server id' }
  }
  return { status: 'ok', record }
}

/** Unique rules the database or the app enforce for sleep sessions (rule 8). */
async function sleepClash(db: PersonalDataDatabase, session: SleepSession): Promise<string | null> {
  const sameKey = await db.sleepSessions.where('dedupeKey').equals(session.dedupeKey).first()
  if (sameKey && sameKey.id !== session.id) {
    return `the same source record is already on this device as another session (${sameKey.id})`
  }

  if (session.source === 'manual' && session.deletedAt === null) {
    const sameStart = await db.sleepSessions.where('startUtc').equals(session.startUtc).toArray()
    const duplicate = sameStart.some(
      (other) =>
        other.id !== session.id &&
        other.source === 'manual' &&
        other.deletedAt === null &&
        other.endUtc === session.endUtc,
    )
    if (duplicate) return 'a manual session with the same bedtime and wake time is already on this device'
  }
  return null
}

/** Unique rule for imported samples: one record per source and day. */
async function sampleClash(db: PersonalDataDatabase, sample: ExternalSample): Promise<string | null> {
  const sameKey = await db.externalSamples.where('dedupeKey').equals(sample.dedupeKey).first()
  if (sameKey && sameKey.id !== sample.id) {
    return `the same record from the same source is already on this device as another record (${sameKey.id})`
  }
  return null
}

async function recordProblem(
  db: PersonalDataDatabase,
  row: RowRef,
  local: SyncedRecord | undefined,
  raw: unknown,
  reason: string,
  now: Date,
): Promise<ApplyOutcome> {
  const id = conflictId(row.collection, row.recordId)
  const existing = await db.syncConflicts.get(id)
  if (existing?.kind === 'invalid-remote' && existing.remoteRevision === row.revision) {
    return 'skipped'
  }

  await db.syncConflicts.put({
    id,
    kind: 'invalid-remote',
    collection: row.collection,
    recordId: row.recordId,
    remoteRecord: raw,
    remoteRevision: row.revision,
    reason,
    detectedAt: now.toISOString(),
  })

  // Uploading this record would only conflict with the server version.
  if (local && local.syncStatus !== 'conflict') {
    await tableOf(db, row.collection).put({ ...local, syncStatus: 'conflict' })
  }
  return 'problem'
}

async function applyOne(db: PersonalDataDatabase, item: Incoming, now: Date): Promise<ApplyOutcome> {
  const { row } = item
  const table = tableOf(db, row.collection)
  const local = await table.get(row.recordId)

  // Already agreed on (for example this device's own upload).
  if (local && local.syncedRevision === row.revision) {
    return 'skipped'
  }

  // Older than a version the server already confirmed to this device:
  // server revisions only increase, so this is a rollback (server restored
  // from a backup, or tampered with). Never adopted. This device's version
  // is uploaded again on top of the server's actual revision (like "keep
  // this device's version"), which repairs the server copy. A record in
  // conflict is left for the user.
  if (local && local.syncedRevision !== null && row.revision < local.syncedRevision) {
    if (local.syncStatus !== 'conflict') {
      await table.put({ ...local, syncStatus: 'pending', syncedRevision: row.revision })
    }
    return 'stale'
  }

  if (item.status === 'unreadable') {
    return recordProblem(db, row, local, null, item.reason, now)
  }

  const validation = await validateIncoming(db, row, item.raw)
  if (validation.status === 'invalid') {
    return recordProblem(db, row, local, item.raw, validation.reason, now)
  }
  const remote = validation.record
  const id = conflictId(row.collection, row.recordId)

  const decision = decideMerge(local, row.revision, local !== undefined && sameContent(local, remote))

  if (decision === 'skip') {
    return 'skipped'
  }

  if (decision === 'adopt-remote') {
    if (row.collection === 'sleepSessions') {
      const clash = await sleepClash(db, remote as unknown as SleepSession)
      if (clash) return recordProblem(db, row, local, item.raw, clash, now)
    }
    if (row.collection === 'externalSamples') {
      const clash = await sampleClash(db, remote as unknown as ExternalSample)
      if (clash) return recordProblem(db, row, local, item.raw, clash, now)
    }
    await table.put(remote)
    await db.syncConflicts.delete(id)
    return 'applied'
  }

  // Conflict: keep the local version, keep the server version aside.
  const existing = await db.syncConflicts.get(id)
  if (existing?.kind === 'conflict' && existing.remoteRevision === row.revision && local?.syncStatus === 'conflict') {
    return 'skipped'
  }
  await table.put({ ...(local as SyncedRecord), syncStatus: 'conflict' })
  await db.syncConflicts.put({
    id,
    kind: 'conflict',
    collection: row.collection,
    recordId: row.recordId,
    remoteRecord: remote,
    remoteRevision: row.revision,
    detectedAt: now.toISOString(),
  })
  return 'conflict'
}

/** Merges server records in one transaction, optionally advancing lastServerSeq. */
async function applyIncoming(
  db: PersonalDataDatabase,
  items: Incoming[],
  now: Date,
  counts: SyncCounts,
  newLastServerSeq?: number,
): Promise<void> {
  const ordered = [...items].sort(
    (a, b) => APPLY_ORDER.indexOf(a.row.collection) - APPLY_ORDER.indexOf(b.row.collection),
  )

  await db.transaction('rw', syncTables(db), async () => {
    for (const item of ordered) {
      const outcome = await applyOne(db, item, now)
      if (outcome === 'applied') counts.applied += 1
      if (outcome === 'conflict') counts.conflicts += 1
      if (outcome === 'problem') counts.problems += 1
      if (outcome === 'stale') counts.stale += 1
    }

    if (newLastServerSeq !== undefined) {
      const state = await db.syncState.get('current')
      if (state && newLastServerSeq > state.lastServerSeq) {
        await db.syncState.put({ ...state, lastServerSeq: newLastServerSeq })
      }
    }
  })
}

/**
 * Re-checks stored "invalid-remote" problems with the rules of the app
 * version now running (e.g. records an older version could not use).
 * A problem that now passes goes through the normal merge rules (applied,
 * or a conflict if this device changed the record too) and leaves the
 * list; one made outdated by a newer server version is removed; one that
 * still fails stays as it is. Problems without a readable copy (could not
 * be decrypted) cannot be re-checked and are left alone.
 */
async function retryStoredProblems(db: PersonalDataDatabase, now: Date, counts: SyncCounts): Promise<void> {
  await db.transaction('rw', syncTables(db), async () => {
    const problems = (await db.syncConflicts.where('kind').equals('invalid-remote').toArray())
      .filter((issue) => issue.remoteRecord !== null && issue.remoteRecord !== undefined && issue.remoteRevision !== null)
      // Habits before the entries that refer to them.
      .sort((a, b) => APPLY_ORDER.indexOf(a.collection) - APPLY_ORDER.indexOf(b.collection))

    for (const issue of problems) {
      const revision = issue.remoteRevision as number
      const local = await tableOf(db, issue.collection).get(issue.recordId)

      if (local && local.syncedRevision !== null && local.syncedRevision >= revision) {
        await db.syncConflicts.delete(issue.id)
        continue
      }

      const row = { collection: issue.collection, recordId: issue.recordId, revision }
      if ((await validateIncoming(db, row, issue.remoteRecord)).status === 'invalid') continue

      // Recording the problem marked this device's copy "conflict" only to
      // stop uploads. If it was not edited since the last sync (revision ==
      // synced revision), it is really "synced": only the server changed.
      if (local && local.syncStatus === 'conflict' && local.syncedRevision !== null && local.revision === local.syncedRevision) {
        await tableOf(db, issue.collection).put({ ...local, syncStatus: 'synced' })
      }

      const outcome = await applyOne(
        db,
        { row, status: 'decrypted', raw: issue.remoteRecord },
        now,
      )
      if (outcome === 'applied') counts.applied += 1
      if (outcome === 'conflict') counts.conflicts += 1
    }
  })
}

// --- push ------------------------------------------------------------------

async function markPushed(
  db: PersonalDataDatabase,
  collection: SyncCollection,
  recordId: string,
  revision: number,
): Promise<void> {
  const table = tableOf(db, collection)
  await db.transaction('rw', table, async () => {
    const current = await table.get(recordId)
    if (!current) return
    // Edited again during the upload: the server has the older revision,
    // so the record stays pending with the new agreed revision.
    await table.put(
      current.revision === revision
        ? { ...current, syncStatus: 'synced', syncedRevision: revision }
        : { ...current, syncedRevision: revision },
    )
  })
}

async function pushOne(
  ctx: SyncContext,
  state: SyncStateRecord,
  collection: SyncCollection,
  record: SyncedRecord,
  counts: SyncCounts,
  notPushed: NotPushed[],
): Promise<void> {
  const recordId = String(record[keyField(collection)])
  const encrypted = await encryptRecord(
    state.dataKey,
    { userId: state.userId, collection, recordId, revision: record.revision, keyVersion: state.keyVersion },
    uploadContent(record),
  )
  if (encrypted.status === 'too-large') {
    notPushed.push({ collection, recordId, reason: 'too large to synchronise' })
    return
  }

  let expectedRevision = record.syncedRevision
  for (let attempt = 0; attempt < 2; attempt++) {
    let response
    try {
      response = await ctx.server.pushRecord({
        collection,
        recordId,
        expectedRevision,
        revision: record.revision,
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        keyVersion: state.keyVersion,
      })
    } catch (error) {
      // The server refused this one record: report it, continue with others.
      if (error instanceof SyncServerError && error.kind === 'server') {
        notPushed.push({ collection, recordId, reason: error.message })
        return
      }
      throw error
    }

    if (response.status === 'ok') {
      await markPushed(ctx.db, collection, recordId, record.revision)
      counts.pushed += 1
      return
    }

    if (response.current === null) {
      if (expectedRevision === null) {
        throw new SyncServerError('invalid-response', 'conflict without a server version')
      }
      // The server no longer has the record (e.g. cloud data deleted):
      // upload it again as new. Nothing is lost.
      expectedRevision = null
      continue
    }

    // The server holds an OLDER version than the one it confirmed to this
    // device, and it was not downloaded (e.g. restored rows keep their old
    // sequence numbers): upload this device's version on top of it.
    if (expectedRevision !== null && response.current.revision < expectedRevision) {
      counts.stale += 1
      expectedRevision = response.current.revision
      continue
    }

    // The server holds another version: merge it like a pulled record.
    const incoming = await decryptAll(state, [response.current])
    await applyIncoming(ctx.db, incoming, (ctx.now ?? (() => new Date()))(), counts)
    return
  }
}

// --- round -----------------------------------------------------------------

function emptyCounts(): SyncCounts {
  return { pulled: 0, applied: 0, conflicts: 0, problems: 0, pushed: 0, stale: 0 }
}

function failure(
  stage: 'pull' | 'push',
  error: unknown,
  counts: SyncCounts,
  notPushed: NotPushed[],
): SyncRoundResult {
  return {
    status: 'failed',
    stage,
    kind: error instanceof SyncServerError ? error.kind : 'local',
    message: messageOf(error),
    notPushed,
    ...counts,
  }
}

async function round(ctx: SyncContext): Promise<SyncRoundResult> {
  const { db, server } = ctx
  const now = ctx.now ?? (() => new Date())
  const counts = emptyCounts()
  const notPushed: NotPushed[] = []

  const state = await db.syncState.get('current')
  if (!state) return { status: 'not-set-up' }

  let userId: string | null
  try {
    userId = await server.currentUserId()
  } catch (error) {
    return failure('pull', error, counts, notPushed)
  }
  if (userId === null) return { status: 'signed-out' }
  if (userId !== state.userId) return { status: 'account-mismatch' }

  // Never upload with a key the account no longer has: after "delete my
  // cloud data" that would silently refill the cloud with old data.
  let envelope
  try {
    envelope = await server.getKeyEnvelope()
  } catch (error) {
    return failure('pull', error, counts, notPushed)
  }
  if (!envelope) {
    await unlinkDevice(db)
    return { status: 'cloud-deleted' }
  }
  if (envelope.keyVersion !== state.keyVersion) return { status: 'key-changed' }

  try {
    const rows = await pullAll(server, state.lastServerSeq)
    counts.pulled = rows.length
    const incoming = await decryptAll(state, rows)
    const newSeq = rows.reduce((max, row) => Math.max(max, row.serverSeq), state.lastServerSeq)
    await applyIncoming(db, incoming, now(), counts, newSeq)
    await retryStoredProblems(db, now(), counts)
  } catch (error) {
    return failure('pull', error, counts, notPushed)
  }

  try {
    for (const collection of APPLY_ORDER) {
      const pending = await tableOf(db, collection).where('syncStatus').equals('pending').toArray()
      for (const record of pending) {
        await pushOne(ctx, state, collection, record, counts, notPushed)
      }
    }
  } catch (error) {
    return failure('push', error, counts, notPushed)
  }

  return { status: 'ok', notPushed, ...counts }
}

const runningRounds = new Set<string>()

/**
 * Runs one sync round. Only one round runs at a time per database (and per
 * browser, when the Web Locks API is available); others return "busy".
 */
export async function runSyncRound(ctx: SyncContext): Promise<SyncRoundResult> {
  const key = ctx.db.name
  if (runningRounds.has(key)) return { status: 'busy' }
  runningRounds.add(key)

  try {
    const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
    if (!locks) return await round(ctx)
    return await locks.request(`pda-sync:${key}`, { ifAvailable: true }, async (lock) =>
      lock ? round(ctx) : ({ status: 'busy' } as const),
    )
  } finally {
    runningRounds.delete(key)
  }
}

/**
 * Runs `task` while no sync round can run on this database: waits for a
 * running round to finish, and makes new rounds answer "busy" meanwhile
 * (used by "Delete all data on this device", so a sync cannot write data
 * back during or after the deletion).
 */
export async function runWithSyncPaused<T>(db: { name: string }, task: () => Promise<T>): Promise<T> {
  const key = db.name
  // Wait for an in-memory round of this tab to finish.
  while (runningRounds.has(key)) await new Promise((resolve) => setTimeout(resolve, 50))
  runningRounds.add(key)
  try {
    const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
    if (!locks) return await task()
    return await locks.request(`pda-sync:${key}`, async () => task())
  } finally {
    runningRounds.delete(key)
  }
}

// --- conflict resolution ---------------------------------------------------

export type ConflictChoice = 'keep-this-device' | 'keep-other'

/**
 * Resolves one sync issue chosen by the user (SYNC_DESIGN.md §6 rule 3).
 *
 * - keep-other: this device takes the server version (already on the
 *   server, so nothing needs uploading).
 * - keep-this-device: this device's version is uploaded at the next sync
 *   as a new revision on top of the server version.
 *
 * Problems (server version unusable) can only be resolved by keeping this
 * device's version, and only if the record exists on this device.
 */
export async function resolveConflict(
  db: PersonalDataDatabase,
  id: string,
  choice: ConflictChoice,
): Promise<void> {
  await db.transaction('rw', syncTables(db), async () => {
    const issue: SyncConflictRecord | undefined = await db.syncConflicts.get(id)
    if (!issue) throw new Error(messages().syncText.conflictGone)

    const table = tableOf(db, issue.collection)
    const local = await table.get(issue.recordId)

    if (choice === 'keep-other') {
      if (issue.kind !== 'conflict' || !issue.remoteRecord || typeof issue.remoteRecord !== 'object') {
        throw new Error(messages().syncText.otherUnusable)
      }
      const revision = issue.remoteRevision ?? 1
      await table.put({
        ...(issue.remoteRecord as SyncedRecord),
        syncStatus: 'synced',
        revision,
        syncedRevision: revision,
      })
    } else {
      if (!local) throw new Error(messages().syncText.noLocalVersion)
      const serverRevision = issue.remoteRevision
      await table.put({
        ...local,
        syncStatus: 'pending',
        syncedRevision: serverRevision,
        revision: Math.max(local.revision, serverRevision ?? 0) + 1,
      })
    }

    await db.syncConflicts.delete(id)
  })
}
