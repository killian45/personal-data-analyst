/**
 * In-memory sync server for tests. Follows the same rules as
 * push_record in supabase/migrations/20261110140321_sync_schema.sql;
 * supabase/tests and src/sync/*.dbtest.ts check the real server.
 * Test-only: never imported by the app.
 */

import type { KeyEnvelope } from '../crypto'
import { SyncServerError, type PushRequest, type PushResponse, type RemoteRow, type SyncServer } from '../server'

export interface MemoryServer extends SyncServer {
  /** Rows exactly as stored, in server_seq order. */
  rows(): RemoteRow[]
  /** Simulates "delete my cloud data". */
  clear(): void
  /** Makes the next n requests fail as if the network were down. */
  failNext(n: number): void
  /** Called before each push is processed (to simulate edits during sync). */
  beforePush?: (request: PushRequest) => Promise<void> | void
  signedInAs: string | null
  /** Stores a row directly (simulates another client or a damaged row). */
  inject(row: Omit<RemoteRow, 'serverSeq'>): RemoteRow
  /** The stored wrapped key (null: none). Tests may set it directly. */
  envelope: KeyEnvelope | null
}

/** A placeholder envelope for tests that do not unwrap keys. */
export const PLACEHOLDER_ENVELOPE: KeyEnvelope = {
  wrappedKeyPass: new Uint8Array(40),
  wrappedKeyRec: new Uint8Array(40),
  salt: new Uint8Array(16),
  iterations: 100_000,
  keyVersion: 1,
}

export function createMemoryServer(
  userId: string,
  envelope: KeyEnvelope | null = PLACEHOLDER_ENVELOPE,
): MemoryServer {
  const stored = new Map<string, RemoteRow>()
  let seq = 0
  let failures = 0

  const key = (collection: string, recordId: string) => `${collection}:${recordId}`
  const copy = (row: RemoteRow): RemoteRow => ({
    ...row,
    ciphertext: new Uint8Array(row.ciphertext),
    iv: new Uint8Array(row.iv),
  })

  function maybeFail() {
    if (failures > 0) {
      failures -= 1
      throw new SyncServerError('network', 'simulated network failure')
    }
  }

  const server: MemoryServer = {
    signedInAs: userId,
    envelope,

    async getKeyEnvelope() {
      maybeFail()
      return server.envelope
    },

    async createKeyEnvelope(next) {
      maybeFail()
      if (server.envelope) throw new SyncServerError('server', 'a key already exists for this account')
      server.envelope = next
    },

    async updatePassphraseWrap(userIdToUpdate, next) {
      maybeFail()
      if (!server.envelope || userIdToUpdate !== server.signedInAs) {
        throw new SyncServerError('server', 'the account has no encryption key to update')
      }
      server.envelope = {
        ...server.envelope,
        wrappedKeyPass: next.wrappedKeyPass,
        salt: next.salt,
        iterations: next.iterations,
      }
    },

    async deleteCloudData() {
      maybeFail()
      const count = stored.size
      server.envelope = null
      stored.clear()
      return count
    },

    async currentUserId() {
      maybeFail()
      return server.signedInAs
    },

    async pullChanges(afterSeq, limit) {
      maybeFail()
      return [...stored.values()]
        .filter((row) => row.serverSeq > afterSeq)
        .sort((a, b) => a.serverSeq - b.serverSeq)
        .slice(0, limit)
        .map(copy)
    },

    async pushRecord(request): Promise<PushResponse> {
      await server.beforePush?.(request)
      maybeFail()

      if (request.revision < 1 || (request.expectedRevision !== null && request.revision <= request.expectedRevision)) {
        throw new SyncServerError('server', 'revision must be higher than the expected revision')
      }
      if (request.iv.length !== 12 || request.ciphertext.length < 1 || request.ciphertext.length > 1024 * 1024) {
        throw new SyncServerError('server', 'invalid envelope')
      }

      const current = stored.get(key(request.collection, request.recordId))
      if (!current) {
        if (request.expectedRevision !== null) return { status: 'conflict', current: null }
      } else if (request.expectedRevision === null || current.revision !== request.expectedRevision) {
        return { status: 'conflict', current: copy(current) }
      }

      seq += 1
      stored.set(key(request.collection, request.recordId), {
        collection: request.collection,
        recordId: request.recordId,
        revision: request.revision,
        ciphertext: new Uint8Array(request.ciphertext),
        iv: new Uint8Array(request.iv),
        keyVersion: request.keyVersion,
        serverSeq: seq,
      })
      return { status: 'ok', revision: request.revision, serverSeq: seq }
    },

    rows: () => [...stored.values()].sort((a, b) => a.serverSeq - b.serverSeq).map(copy),
    clear: () => stored.clear(),
    failNext: (n) => {
      failures = n
    },
    inject(row) {
      seq += 1
      const full = { ...row, serverSeq: seq }
      stored.set(key(row.collection, row.recordId), full)
      return copy(full)
    },
  }

  return server
}
