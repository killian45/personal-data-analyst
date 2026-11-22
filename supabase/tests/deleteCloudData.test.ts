// delete_my_cloud_data: removes only the caller's records and key, atomically.
import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { anonymousClient, createTestUser, pushOk, userKeyRow, type TestUser } from './helpers.ts'

let alice: TestUser
let bob: TestUser

beforeAll(async () => {
  alice = await createTestUser()
  bob = await createTestUser()
  for (const user of [alice, bob]) {
    expect((await user.client.from('user_keys').insert(userKeyRow())).error).toBeNull()
    await pushOk(user.client, { recordId: randomUUID(), expectedRevision: null, revision: 1 })
    await pushOk(user.client, { recordId: randomUUID(), expectedRevision: null, revision: 1 })
  }
})

describe('delete_my_cloud_data', () => {
  it('deletes the caller\'s records and key, and returns the number of records', async () => {
    const { data, error } = await alice.client.rpc('delete_my_cloud_data')
    expect(error).toBeNull()
    expect(data).toBe(2)

    expect((await alice.client.from('sync_records').select('record_id')).data).toEqual([])
    expect((await alice.client.from('user_keys').select('user_id')).data).toEqual([])
  })

  it('leaves other users untouched', async () => {
    expect((await bob.client.from('sync_records').select('record_id')).data).toHaveLength(2)
    expect((await bob.client.from('user_keys').select('user_id')).data).toEqual([{ user_id: bob.id }])
  })

  it('is refused for anonymous visitors', async () => {
    const { error } = await anonymousClient().rpc('delete_my_cloud_data')
    expect(error?.code).toBe('42501')
  })
})
