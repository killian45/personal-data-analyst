import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { db } from '../database/db'

import {
  describeDisplayTimezone,
  loadDisplayTimezone,
  resolveDisplayZone,
  saveDisplayTimezone,
} from './displayTimezone'

describe('resolveDisplayZone', () => {
  it('uses the event timezone, the device timezone or a fixed timezone', () => {
    expect(resolveDisplayZone('event', 'Asia/Tokyo', 'Europe/Paris')).toBe('Asia/Tokyo')
    expect(resolveDisplayZone('device', 'Asia/Tokyo', 'Europe/Paris')).toBe('Europe/Paris')
    expect(resolveDisplayZone('America/New_York', 'Asia/Tokyo', 'Europe/Paris')).toBe('America/New_York')
  })
})

describe('describeDisplayTimezone', () => {
  it('describes each choice in plain language', () => {
    expect(describeDisplayTimezone('event')).toBe('the timezone where each entry happened')
    expect(describeDisplayTimezone('device', 'Europe/Paris')).toBe("this device's timezone (Europe/Paris)")
    expect(describeDisplayTimezone('Asia/Tokyo')).toBe('Asia/Tokyo')
  })
})

describe('storing the display timezone', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(async () => {
    db.close()
    await db.delete()
  })

  it('defaults to the event timezone', async () => {
    expect(await loadDisplayTimezone()).toBe('event')
  })

  it('saves and reloads each kind of choice', async () => {
    for (const value of ['device', ' Asia/Tokyo ', 'event']) {
      await saveDisplayTimezone(value)
      expect(await loadDisplayTimezone()).toBe(value.trim())
    }
  })

  it('rejects an unknown timezone and keeps the previous choice', async () => {
    await saveDisplayTimezone('Asia/Tokyo')

    await expect(saveDisplayTimezone('Mars/Olympus')).rejects.toThrow('Invalid IANA timezone.')
    expect(await loadDisplayTimezone()).toBe('Asia/Tokyo')
  })

  it('falls back to the default if a stored value is no longer valid', async () => {
    await db.settings.put({
      key: 'displayTimezone',
      value: 'Mars/Olympus',
      updatedAt: '2026-11-09T00:00:00.000Z',
      deletedAt: null,
      syncStatus: 'pending',
      revision: 1,
      syncedRevision: null,
    })

    expect(await loadDisplayTimezone()).toBe('event')
  })
})
