/**
 * The sync server as seen by the sync engine (docs/SYNC_DESIGN.md §4–5).
 *
 * The engine only uses this interface, so it can be tested against an
 * in-memory server and against the real (local) Supabase.
 * Everything that crosses this boundary is already encrypted.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

import type { KeyEnvelope } from './crypto'
import { SYNC_COLLECTIONS, type SyncCollection } from './types'

type Bytes = Uint8Array<ArrayBuffer>

/** One encrypted record as stored on the server. */
export interface RemoteRow {
  collection: SyncCollection
  recordId: string
  revision: number
  ciphertext: Bytes
  iv: Bytes
  keyVersion: number
  serverSeq: number
}

export interface PushRequest {
  collection: SyncCollection
  recordId: string
  /** The server revision this device last agreed on; null if never synced. */
  expectedRevision: number | null
  revision: number
  ciphertext: Bytes
  iv: Bytes
  keyVersion: number
}

export type PushResponse =
  | { status: 'ok'; revision: number; serverSeq: number }
  /** Nothing was written. current is the server's version (null if it has none). */
  | { status: 'conflict'; current: RemoteRow | null }

export interface SyncServer {
  /** Id of the signed-in user, or null if signed out. */
  currentUserId(): Promise<string | null>
  /** Records changed after server_seq afterSeq, in server_seq order. */
  pullChanges(afterSeq: number, limit: number): Promise<RemoteRow[]>
  pushRecord(request: PushRequest): Promise<PushResponse>
  /** The signed-in user's wrapped data key, or null if there is none. */
  getKeyEnvelope(): Promise<KeyEnvelope | null>
  /** Stores the wrapped data key (first device). Fails if one exists. */
  createKeyEnvelope(envelope: KeyEnvelope): Promise<void>
  /**
   * Replaces the passphrase wrapping (new passphrase). The data key and the
   * recovery wrapping stay the same. Fails if the account has no key.
   */
  updatePassphraseWrap(userId: string, envelope: KeyEnvelope): Promise<void>
  /** Deletes all of the user's records and the wrapped key, atomically. */
  deleteCloudData(): Promise<number>
}

export type SyncServerErrorKind = 'network' | 'auth' | 'server' | 'invalid-response'

/** Any failure to talk to the server. The engine stops the round safely. */
export class SyncServerError extends Error {
  readonly kind: SyncServerErrorKind

  constructor(kind: SyncServerErrorKind, message: string) {
    super(message)
    this.name = 'SyncServerError'
    this.kind = kind
  }
}

// --- bytea encoding (PostgREST represents bytea as "\x" + hex) -------------

export function bytesToHex(bytes: Uint8Array): string {
  let hex = '\\x'
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0')
  return hex
}

export function hexToBytes(value: unknown): Bytes {
  if (typeof value !== 'string' || !/^\\x(?:[0-9a-fA-F]{2})*$/.test(value)) {
    throw new SyncServerError('invalid-response', 'invalid binary value from the server')
  }
  const bytes = new Uint8Array((value.length - 2) / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(value.slice(2 + i * 2, 4 + i * 2), 16)
  }
  return bytes
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1
}

/** Checks one row received from the server (never trusted blindly). */
export function parseRemoteRow(raw: unknown): RemoteRow {
  if (!raw || typeof raw !== 'object') {
    throw new SyncServerError('invalid-response', 'invalid row from the server')
  }
  const row = raw as Record<string, unknown>
  const collection = row.collection
  if (!SYNC_COLLECTIONS.includes(collection as SyncCollection)) {
    throw new SyncServerError('invalid-response', 'unknown collection from the server')
  }
  if (typeof row.record_id !== 'string' || row.record_id.length === 0) {
    throw new SyncServerError('invalid-response', 'invalid record id from the server')
  }
  // server_seq is a bigint; PostgREST sends it as a JSON number while it fits.
  if (!isPositiveInteger(row.revision) || !isPositiveInteger(row.key_version) || !isPositiveInteger(row.server_seq)) {
    throw new SyncServerError('invalid-response', 'invalid numbers in a row from the server')
  }
  return {
    collection: collection as SyncCollection,
    recordId: row.record_id,
    revision: row.revision,
    ciphertext: hexToBytes(row.ciphertext),
    iv: hexToBytes(row.iv),
    keyVersion: row.key_version,
    serverSeq: row.server_seq,
  }
}

function classify(error: { message?: string; code?: string; status?: number } | Error): SyncServerError {
  const message = error.message ?? 'unknown error'
  const code = 'code' in error ? error.code : undefined
  if (/fetch|network|Failed to fetch|NetworkError|ECONNREFUSED/i.test(message) && !code) {
    return new SyncServerError('network', message)
  }
  if (code === '42501' || code === 'PGRST301' || code === 'PGRST303') {
    return new SyncServerError('auth', message)
  }
  return new SyncServerError('server', message)
}

const ROW_COLUMNS = 'collection, record_id, revision, ciphertext, iv, key_version, server_seq'

/** The real server: Supabase (local stack or the Paris project). */
export function createSupabaseSyncServer(client: SupabaseClient): SyncServer {
  return {
    async currentUserId() {
      const { data, error } = await client.auth.getSession()
      if (error) throw classify(error)
      return data.session?.user.id ?? null
    },

    async pullChanges(afterSeq, limit) {
      let result
      try {
        result = await client
          .from('sync_records')
          .select(ROW_COLUMNS)
          .gt('server_seq', afterSeq)
          .order('server_seq', { ascending: true })
          .limit(limit)
      } catch (caught) {
        throw classify(caught as Error)
      }
      if (result.error) throw classify(result.error)
      return (result.data ?? []).map(parseRemoteRow)
    },

    async pushRecord(request) {
      let result
      try {
        result = await client.rpc('push_record', {
          p_collection: request.collection,
          p_record_id: request.recordId,
          p_expected_revision: request.expectedRevision,
          p_revision: request.revision,
          p_ciphertext: bytesToHex(request.ciphertext),
          p_iv: bytesToHex(request.iv),
          p_key_version: request.keyVersion,
        })
      } catch (caught) {
        throw classify(caught as Error)
      }
      if (result.error) throw classify(result.error)

      const data = result.data as Record<string, unknown> | null
      if (data?.status === 'ok' && isPositiveInteger(data.revision) && isPositiveInteger(data.server_seq)) {
        return { status: 'ok', revision: data.revision, serverSeq: data.server_seq }
      }
      if (data?.status === 'conflict') {
        return { status: 'conflict', current: data.current === null ? null : parseRemoteRow(data.current) }
      }
      throw new SyncServerError('invalid-response', 'unexpected answer from push_record')
    },

    async getKeyEnvelope() {
      let result
      try {
        result = await client
          .from('user_keys')
          .select('wrapped_key_pass, wrapped_key_rec, salt, iterations, key_version')
          .maybeSingle()
      } catch (caught) {
        throw classify(caught as Error)
      }
      if (result.error) throw classify(result.error)
      const row = result.data as Record<string, unknown> | null
      if (!row) return null
      if (!isPositiveInteger(row.iterations) || !isPositiveInteger(row.key_version)) {
        throw new SyncServerError('invalid-response', 'invalid key envelope from the server')
      }
      return {
        wrappedKeyPass: hexToBytes(row.wrapped_key_pass),
        wrappedKeyRec: hexToBytes(row.wrapped_key_rec),
        salt: hexToBytes(row.salt),
        iterations: row.iterations,
        keyVersion: row.key_version,
      }
    },

    async createKeyEnvelope(envelope) {
      let result
      try {
        result = await client.from('user_keys').insert({
          wrapped_key_pass: bytesToHex(envelope.wrappedKeyPass),
          wrapped_key_rec: bytesToHex(envelope.wrappedKeyRec),
          salt: bytesToHex(envelope.salt),
          iterations: envelope.iterations,
          key_version: envelope.keyVersion,
        })
      } catch (caught) {
        throw classify(caught as Error)
      }
      if (result.error) throw classify(result.error)
    },

    async updatePassphraseWrap(userId, envelope) {
      let result
      try {
        result = await client
          .from('user_keys')
          .update({
            wrapped_key_pass: bytesToHex(envelope.wrappedKeyPass),
            salt: bytesToHex(envelope.salt),
            iterations: envelope.iterations,
          })
          .eq('user_id', userId)
          .select('user_id')
      } catch (caught) {
        throw classify(caught as Error)
      }
      if (result.error) throw classify(result.error)
      if (!result.data || result.data.length !== 1) {
        throw new SyncServerError('server', 'the account has no encryption key to update')
      }
    },

    async deleteCloudData() {
      let result
      try {
        result = await client.rpc('delete_my_cloud_data')
      } catch (caught) {
        throw classify(caught as Error)
      }
      if (result.error) throw classify(result.error)
      return typeof result.data === 'number' ? result.data : 0
    },
  }
}
