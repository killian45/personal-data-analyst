// push_record: the revision rule (SYNC_DESIGN.md §5.3) and envelope
// validation (§4.3), plus the server_seq ordering used by pulls (§5.2).
import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { createTestUser, push, pushOk, randomHex, type TestUser } from './helpers.ts'

let user: TestUser

beforeAll(async () => {
  user = await createTestUser()
})

describe('revision rule', () => {
  it('accepts a new record with no expected revision', async () => {
    const result = await pushOk(user.client, { expectedRevision: null, revision: 1 })
    expect(result.revision).toBe(1)
    expect(result.server_seq).toBeGreaterThan(0)
  })

  it('accepts an update when the expected revision matches, and increases server_seq', async () => {
    const recordId = randomUUID()
    const first = await pushOk(user.client, { recordId, expectedRevision: null, revision: 1 })
    const second = await pushOk(user.client, { recordId, expectedRevision: 1, revision: 2 })
    expect(second.revision).toBe(2)
    expect(second.server_seq).toBeGreaterThan(first.server_seq)
  })

  it('accepts a revision that jumps by more than one (several offline edits)', async () => {
    const recordId = randomUUID()
    await pushOk(user.client, { recordId, expectedRevision: null, revision: 1 })
    const result = await pushOk(user.client, { recordId, expectedRevision: 1, revision: 4 })
    expect(result.revision).toBe(4)
  })

  it('returns a conflict, without writing, when another device changed the record first', async () => {
    const recordId = randomUUID()
    await pushOk(user.client, { recordId, expectedRevision: null, revision: 1 })
    const winnerCiphertext = randomHex(48)
    await pushOk(user.client, {
      recordId,
      expectedRevision: 1,
      revision: 2,
      ciphertext: winnerCiphertext,
    })

    // A second device still thinks the server has revision 1.
    const { data, error } = await push(user.client, { recordId, expectedRevision: 1, revision: 2 })
    expect(error).toBeNull()
    expect(data?.status).toBe('conflict')
    if (data?.status !== 'conflict') return
    expect(data.current?.revision).toBe(2)
    expect(data.current?.ciphertext).toBe(winnerCiphertext)
    expect(data.current).not.toHaveProperty('user_id')

    const stored = await user.client
      .from('sync_records')
      .select('revision, ciphertext')
      .eq('record_id', recordId)
      .single()
    expect(stored.data).toEqual({ revision: 2, ciphertext: winnerCiphertext })
  })

  it('returns a conflict when a "new" record already exists on the server', async () => {
    const recordId = randomUUID()
    await pushOk(user.client, { recordId, expectedRevision: null, revision: 1 })
    const { data } = await push(user.client, { recordId, expectedRevision: null, revision: 1 })
    expect(data?.status).toBe('conflict')
    if (data?.status === 'conflict') expect(data.current?.revision).toBe(1)
  })

  it('returns a conflict with no current version when the server no longer has the record', async () => {
    const { data, error } = await push(user.client, { expectedRevision: 3, revision: 4 })
    expect(error).toBeNull()
    expect(data).toEqual({ status: 'conflict', current: null })
  })

  it('refuses a revision that is not higher than the expected one', async () => {
    const recordId = randomUUID()
    await pushOk(user.client, { recordId, expectedRevision: null, revision: 1 })
    const same = await push(user.client, { recordId, expectedRevision: 1, revision: 1 })
    expect(same.error?.code).toBe('22023')
    const lower = await push(user.client, { recordId, expectedRevision: 1, revision: 0 })
    expect(lower.error?.code).toBe('22023')
  })

  it('lets exactly one of several simultaneous first uploads win', async () => {
    const recordId = randomUUID()
    const results = await Promise.all(
      Array.from({ length: 8 }, () => push(user.client, { recordId, expectedRevision: null, revision: 1 })),
    )
    expect(results.every((r) => r.error === null)).toBe(true)
    const statuses = results.map((r) => r.data?.status)
    expect(statuses.filter((s) => s === 'ok')).toHaveLength(1)
    expect(statuses.filter((s) => s === 'conflict')).toHaveLength(7)
  })
})

describe('envelope validation', () => {
  it('accepts every synchronised collection, including settings keys', async () => {
    for (const collection of ['habits', 'entries', 'sleepSessions', 'externalSamples', 'contacts', 'contactInteractions']) {
      await pushOk(user.client, { collection, expectedRevision: null, revision: 1 })
    }
    await pushOk(user.client, {
      collection: 'settings',
      recordId: 'dashboard.metrics',
      expectedRevision: null,
      revision: 1,
    })
  })

  it('refuses an unknown collection (activeTimers are never synchronised)', async () => {
    const { error } = await push(user.client, {
      collection: 'activeTimers',
      expectedRevision: null,
      revision: 1,
    })
    expect(error?.code).toBe('23514')
  })

  it('refuses an invalid record id', async () => {
    for (const recordId of ['', 'has space', 'semi;colon', 'x'.repeat(129)]) {
      const { error } = await push(user.client, { recordId, expectedRevision: null, revision: 1 })
      expect(error?.code, recordId).toBe('23514')
    }
  })

  it('refuses an IV that is not 12 bytes', async () => {
    const { error } = await push(user.client, { iv: randomHex(16), expectedRevision: null, revision: 1 })
    expect(error?.code).toBe('23514')
  })

  it('refuses empty ciphertext and ciphertext larger than 1 MiB, accepts exactly 1 MiB', async () => {
    const empty = await push(user.client, { ciphertext: '\\x', expectedRevision: null, revision: 1 })
    expect(empty.error?.code).toBe('23514')

    const tooLarge = await push(user.client, {
      ciphertext: randomHex(1024 * 1024 + 1),
      expectedRevision: null,
      revision: 1,
    })
    expect(tooLarge.error?.code).toBe('23514')

    await pushOk(user.client, { ciphertext: randomHex(1024 * 1024), expectedRevision: null, revision: 1 })
  })

  it('refuses a key version below 1', async () => {
    const { error } = await push(user.client, { keyVersion: 0, expectedRevision: null, revision: 1 })
    expect(error?.code).toBe('23514')
  })
})

describe('direct table writes by the owner', () => {
  it('cannot lower a revision or change a record identity', async () => {
    const recordId = randomUUID()
    await pushOk(user.client, { recordId, expectedRevision: null, revision: 3 })

    const lower = await user.client.from('sync_records').update({ revision: 2 }).eq('record_id', recordId)
    expect(lower.error?.code).toBe('22023')

    const renamed = await user.client
      .from('sync_records')
      .update({ record_id: randomUUID(), revision: 4 })
      .eq('record_id', recordId)
    expect(renamed.error?.code).toBe('22023')
  })

  it('cannot choose its own server_seq', async () => {
    const recordId = randomUUID()
    const { error } = await user.client.from('sync_records').insert({
      collection: 'habits',
      record_id: recordId,
      revision: 1,
      ciphertext: randomHex(32),
      iv: randomHex(12),
      key_version: 1,
      server_seq: 1,
    })
    expect(error).toBeNull()
    const stored = await user.client
      .from('sync_records')
      .select('server_seq')
      .eq('record_id', recordId)
      .single()
    expect(stored.data?.server_seq).toBeGreaterThan(1)
  })
})

describe('changes since server_seq', () => {
  it('returns only later changes, in order', async () => {
    const marker = await pushOk(user.client, { expectedRevision: null, revision: 1 })
    const a = randomUUID()
    const b = randomUUID()
    await pushOk(user.client, { recordId: a, expectedRevision: null, revision: 1 })
    await pushOk(user.client, { recordId: b, expectedRevision: null, revision: 1 })
    await pushOk(user.client, { recordId: a, expectedRevision: 1, revision: 2 })

    const { data, error } = await user.client
      .from('sync_records')
      .select('record_id, revision, server_seq')
      .gt('server_seq', marker.server_seq)
      .order('server_seq')
    expect(error).toBeNull()
    expect(data?.map((r) => [r.record_id, r.revision])).toEqual([
      [b, 1],
      [a, 2],
    ])
  })
})
