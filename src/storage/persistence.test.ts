import { describe, expect, it, vi } from 'vitest'

import {
  getPersistenceStatus,
  getStorageEstimate,
  requestPersistentStorage,
} from './persistence'

function fakeStorage(options: {
  persisted?: boolean
  persistResult?: boolean
  persistThrows?: boolean
  estimate?: StorageEstimate
}) {
  return {
    persisted: vi.fn(async () => options.persisted ?? false),
    persist: vi.fn(async () => {
      if (options.persistThrows) {
        throw new Error('Not allowed')
      }
      return options.persistResult ?? false
    }),
    estimate: vi.fn(async () => options.estimate ?? {}),
  }
}

describe('persistent storage', () => {
  it('reports unsupported when the Storage API is missing', async () => {
    expect(await getPersistenceStatus(undefined)).toBe('unsupported')
    expect(await requestPersistentStorage(undefined)).toBe('unsupported')
    expect(await getStorageEstimate(undefined)).toBeNull()
  })

  it('reads the current status without requesting permission', async () => {
    const storage = fakeStorage({ persisted: false })

    expect(await getPersistenceStatus(storage)).toBe('not-persistent')
    expect(storage.persist).not.toHaveBeenCalled()
  })

  it('does not ask again when storage is already persistent', async () => {
    const storage = fakeStorage({ persisted: true })

    expect(await requestPersistentStorage(storage)).toBe('persistent')
    expect(storage.persist).not.toHaveBeenCalled()
  })

  it('reports persistent when the browser grants the request', async () => {
    const storage = fakeStorage({ persisted: false, persistResult: true })

    expect(await requestPersistentStorage(storage)).toBe('persistent')
    expect(storage.persist).toHaveBeenCalledOnce()
  })

  it('reports not-persistent when the browser refuses', async () => {
    const storage = fakeStorage({ persisted: false, persistResult: false })

    expect(await requestPersistentStorage(storage)).toBe('not-persistent')
  })

  it('reports not-persistent when the request fails', async () => {
    const storage = fakeStorage({ persisted: false, persistThrows: true })

    expect(await requestPersistentStorage(storage)).toBe('not-persistent')
  })

  it('returns usage and quota when available', async () => {
    const storage = fakeStorage({ estimate: { usage: 2048, quota: 1_000_000 } })

    expect(await getStorageEstimate(storage)).toEqual({
      usageBytes: 2048,
      quotaBytes: 1_000_000,
    })
  })

  it('returns null when the estimate is incomplete', async () => {
    const storage = fakeStorage({ estimate: { usage: 2048 } })

    expect(await getStorageEstimate(storage)).toBeNull()
  })
})
