import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { db } from './db'
import { getSettingValue, putSetting, removeSetting } from './settings'

const T1 = new Date('2026-11-10T08:00:00.000Z')
const T2 = new Date('2026-11-10T09:00:00.000Z')
const T3 = new Date('2026-11-10T10:00:00.000Z')

describe('settings storage', () => {
  beforeEach(async () => {
    await db.open()
    await db.settings.clear()
  })

  afterEach(async () => {
    await db.settings.clear()
  })

  it('creates a setting as pending, revision 1, never synchronised', async () => {
    await putSetting('displayTimezone', 'Europe/Paris', T1)

    expect(await db.settings.get('displayTimezone')).toEqual({
      key: 'displayTimezone',
      value: 'Europe/Paris',
      updatedAt: T1.toISOString(),
      deletedAt: null,
      syncStatus: 'pending',
      revision: 1,
      syncedRevision: null,
    })
    expect(await getSettingValue('displayTimezone')).toBe('Europe/Paris')
  })

  it('a change increases the revision and keeps syncedRevision', async () => {
    await db.settings.put({
      key: 'k', value: 'a', updatedAt: T1.toISOString(), deletedAt: null,
      syncStatus: 'synced', revision: 2, syncedRevision: 2,
    })

    await putSetting('k', 'b', T2)

    expect(await db.settings.get('k')).toEqual({
      key: 'k', value: 'b', updatedAt: T2.toISOString(), deletedAt: null,
      syncStatus: 'pending', revision: 3, syncedRevision: 2,
    })
  })

  it('saving the same value changes nothing', async () => {
    await putSetting('k', 'a', T1)
    await putSetting('k', 'a', T2)

    expect(await db.settings.get('k')).toMatchObject({ revision: 1, updatedAt: T1.toISOString() })
  })

  it('removing is a soft deletion that keeps the last value', async () => {
    await putSetting('k', 'a', T1)
    await removeSetting('k', T2)

    expect(await db.settings.get('k')).toEqual({
      key: 'k', value: 'a', updatedAt: T2.toISOString(), deletedAt: T2.toISOString(),
      syncStatus: 'pending', revision: 2, syncedRevision: null,
    })
    expect(await getSettingValue('k')).toBeNull()
  })

  it('removing a missing or already removed setting changes nothing', async () => {
    await removeSetting('missing', T1)
    expect(await db.settings.get('missing')).toBeUndefined()

    await putSetting('k', 'a', T1)
    await removeSetting('k', T2)
    await removeSetting('k', T3)
    expect(await db.settings.get('k')).toMatchObject({ revision: 2, deletedAt: T2.toISOString() })
  })

  it('setting a removed setting again brings it back, even with the same value', async () => {
    await putSetting('k', 'a', T1)
    await removeSetting('k', T2)
    await putSetting('k', 'a', T3)

    expect(await db.settings.get('k')).toMatchObject({
      value: 'a', deletedAt: null, revision: 3, updatedAt: T3.toISOString(),
    })
    expect(await getSettingValue('k')).toBe('a')
  })

  it('a setting in conflict stays in conflict when changed', async () => {
    await db.settings.put({
      key: 'k', value: 'a', updatedAt: T1.toISOString(), deletedAt: null,
      syncStatus: 'conflict', revision: 2, syncedRevision: 1,
    })

    await putSetting('k', 'b', T2)

    expect(await db.settings.get('k')).toMatchObject({ syncStatus: 'conflict', revision: 3, syncedRevision: 1 })
  })
})
