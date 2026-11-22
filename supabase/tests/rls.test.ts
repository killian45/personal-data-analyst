// Row Level Security: each user can reach only their own rows, and anonymous
// visitors can reach nothing (PROJECT_SPEC.md §11.2, SYNC_DESIGN.md §4.2).
import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  anonymousClient,
  createTestUser,
  pushOk,
  randomHex,
  userKeyRow,
  type TestUser,
} from './helpers.ts'

let alice: TestUser
let bob: TestUser

beforeAll(async () => {
  alice = await createTestUser()
  bob = await createTestUser()
})

async function aliceRecord() {
  const recordId = randomUUID()
  await pushOk(alice.client, { recordId, expectedRevision: null, revision: 1 })
  return recordId
}

async function aliceStoredRevision(recordId: string) {
  const { data, error } = await alice.client
    .from('sync_records')
    .select('revision')
    .eq('record_id', recordId)
    .single()
  expect(error).toBeNull()
  return data?.revision
}

describe('sync_records: another user', () => {
  it('cannot read the rows', async () => {
    const recordId = await aliceRecord()

    const own = await alice.client.from('sync_records').select('record_id').eq('record_id', recordId)
    expect(own.data).toHaveLength(1)

    const other = await bob.client.from('sync_records').select('*').eq('record_id', recordId)
    expect(other.error).toBeNull()
    expect(other.data).toEqual([])

    const all = await bob.client.from('sync_records').select('user_id')
    expect(all.data?.every((row) => row.user_id === bob.id)).toBe(true)
  })

  it('cannot insert a row owned by someone else', async () => {
    const { error } = await bob.client.from('sync_records').insert({
      user_id: alice.id,
      collection: 'habits',
      record_id: randomUUID(),
      revision: 1,
      ciphertext: randomHex(32),
      iv: randomHex(12),
      key_version: 1,
    })
    expect(error?.code).toBe('42501')
  })

  it('cannot update the rows', async () => {
    const recordId = await aliceRecord()

    const { data, error } = await bob.client
      .from('sync_records')
      .update({ revision: 99, ciphertext: randomHex(32) })
      .eq('record_id', recordId)
      .select()
    expect(error).toBeNull()
    expect(data).toEqual([])
    expect(await aliceStoredRevision(recordId)).toBe(1)
  })

  it('cannot take over a row by changing its owner', async () => {
    const recordId = randomUUID()
    await pushOk(bob.client, { recordId, expectedRevision: null, revision: 1 })

    const { error } = await bob.client
      .from('sync_records')
      .update({ user_id: alice.id, revision: 2 })
      .eq('record_id', recordId)
    expect(error).not.toBeNull()
  })

  it('cannot delete the rows', async () => {
    const recordId = await aliceRecord()

    const { data, error } = await bob.client
      .from('sync_records')
      .delete()
      .eq('record_id', recordId)
      .select()
    expect(error).toBeNull()
    expect(data).toEqual([])
    expect(await aliceStoredRevision(recordId)).toBe(1)
  })

  it('pushing the same record id creates a separate row and leaves the original alone', async () => {
    const recordId = await aliceRecord()

    const result = await pushOk(bob.client, { recordId, expectedRevision: null, revision: 1 })
    expect(result.revision).toBe(1)

    expect(await aliceStoredRevision(recordId)).toBe(1)
  })
})

describe('sync_records: the owner', () => {
  it('can delete their own rows (used by "delete my cloud data")', async () => {
    const recordId = await aliceRecord()

    const { data, error } = await alice.client
      .from('sync_records')
      .delete()
      .eq('record_id', recordId)
      .select('record_id')
    expect(error).toBeNull()
    expect(data).toEqual([{ record_id: recordId }])
  })
})

describe('user_keys', () => {
  beforeAll(async () => {
    const { error } = await alice.client.from('user_keys').insert(userKeyRow())
    expect(error).toBeNull()
  })

  it('the owner can read their row', async () => {
    const { data, error } = await alice.client.from('user_keys').select('user_id')
    expect(error).toBeNull()
    expect(data).toEqual([{ user_id: alice.id }])
  })

  it('another user cannot read it', async () => {
    const { data, error } = await bob.client.from('user_keys').select('*').eq('user_id', alice.id)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('another user cannot insert a row for someone else', async () => {
    const { error } = await bob.client.from('user_keys').insert({ ...userKeyRow(), user_id: alice.id })
    // Primary key or RLS violation: either way it must be refused.
    expect(error).not.toBeNull()
  })

  it('another user cannot update or delete it', async () => {
    const before = await alice.client.from('user_keys').select('wrapped_key_pass').single()

    const updated = await bob.client
      .from('user_keys')
      .update({ wrapped_key_pass: randomHex(40) })
      .eq('user_id', alice.id)
      .select()
    expect(updated.data).toEqual([])

    const deleted = await bob.client.from('user_keys').delete().eq('user_id', alice.id).select()
    expect(deleted.data).toEqual([])

    const after = await alice.client.from('user_keys').select('wrapped_key_pass').single()
    expect(after.data).toEqual(before.data)
  })

  it('rejects an unsafe iteration count and a wrong salt length', async () => {
    const lowIterations = await bob.client
      .from('user_keys')
      .insert({ ...userKeyRow(), iterations: 1000 })
    expect(lowIterations.error?.code).toBe('23514')

    const shortSalt = await bob.client.from('user_keys').insert({ ...userKeyRow(), salt: randomHex(8) })
    expect(shortSalt.error?.code).toBe('23514')
  })
})

describe('anonymous visitors', () => {
  it('cannot read either table', async () => {
    const anon = anonymousClient()
    const records = await anon.from('sync_records').select('*')
    expect(records.error?.code).toBe('42501')
    const keys = await anon.from('user_keys').select('*')
    expect(keys.error?.code).toBe('42501')
  })

  it('cannot write either table', async () => {
    const anon = anonymousClient()
    const record = await anon.from('sync_records').insert({
      user_id: alice.id,
      collection: 'habits',
      record_id: randomUUID(),
      revision: 1,
      ciphertext: randomHex(32),
      iv: randomHex(12),
      key_version: 1,
    })
    expect(record.error?.code).toBe('42501')

    const key = await anon.from('user_keys').insert({ ...userKeyRow(), user_id: alice.id })
    expect(key.error?.code).toBe('42501')
  })

  it('cannot call push_record', async () => {
    const anon = anonymousClient()
    const { error } = await anon.rpc('push_record', {
      p_collection: 'habits',
      p_record_id: randomUUID(),
      p_expected_revision: null,
      p_revision: 1,
      p_ciphertext: randomHex(32),
      p_iv: randomHex(12),
      p_key_version: 1,
    })
    expect(error?.code).toBe('42501')
  })
})
