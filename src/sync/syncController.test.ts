import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { db } from '../database/db'
import { createHabit } from '../database/habits'
import { createKeys, MIN_PBKDF2_ITERATIONS } from './crypto'
import { linkDevice } from './device'
import { AUTO_SYNC_INTERVAL_MS, createSyncController } from './syncController'
import { createMemoryBackend } from './testing/memoryBackend'

const USER = { id: 'user-1', email: 'me@example.com' }

beforeEach(async () => {
  await db.delete()
  await db.open()
})

afterEach(async () => {
  vi.useRealTimers()
  db.close()
  await db.delete()
})

async function linkedController() {
  const keys = await createKeys('correct horse battery staple', { iterations: MIN_PBKDF2_ITERATIONS })
  const backend = createMemoryBackend({ signedInAs: USER, envelope: keys.envelope })
  await linkDevice(db, { userId: USER.id, dataKey: keys.dataKey, keyVersion: 1 })
  return { backend, controller: createSyncController({ db, backend }) }
}

describe('sync controller', () => {
  it('reports link, pending changes and the last result', async () => {
    const { controller } = await linkedController()
    await createHabit({ name: 'Water', type: 'number', unit: 'ml' })

    await controller.refresh()
    expect(controller.getSnapshot()).toMatchObject({ linkedUserId: USER.id, pending: 1, issues: 0, running: false })

    const result = await controller.syncNow()
    expect(result).toMatchObject({ status: 'ok', pushed: 1 })
    expect(controller.getSnapshot()).toMatchObject({ pending: 0, lastResult: result })
    expect(controller.getSnapshot().lastFinishedAt).not.toBeNull()
  })

  it('tells listeners when a round changed local data, and only then', async () => {
    const { backend, controller } = await linkedController()
    const changed = vi.fn()
    controller.onDataChanged(changed)

    await controller.syncNow()
    expect(changed).not.toHaveBeenCalled()

    backend.server.envelope = null // cloud data deleted elsewhere
    await controller.syncNow()
    expect(changed).toHaveBeenCalledTimes(1)
  })

  it('syncs 2 s after start, every 5 minutes and when back online; never after stop', async () => {
    const { backend, controller } = await linkedController()
    const rounds = vi.spyOn(backend.server, 'currentUserId') // called once per round
    let finished = 0
    let wasRunning = false
    controller.subscribe(() => {
      const { running } = controller.getSnapshot()
      if (wasRunning && !running) finished += 1
      wasRunning = running
    })
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'] })

    const stop = controller.start()
    await vi.advanceTimersByTimeAsync(1900)
    expect(rounds).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(100)
    await vi.waitFor(() => expect(finished).toBe(1))

    await vi.advanceTimersByTimeAsync(AUTO_SYNC_INTERVAL_MS)
    await vi.waitFor(() => expect(finished).toBe(2))

    window.dispatchEvent(new Event('online'))
    await vi.waitFor(() => expect(finished).toBe(3))
    expect(rounds).toHaveBeenCalledTimes(3)

    stop()
    window.dispatchEvent(new Event('online'))
    await vi.advanceTimersByTimeAsync(AUTO_SYNC_INTERVAL_MS)
    expect(rounds).toHaveBeenCalledTimes(3)
  })

  it('does not sync automatically when the device is not linked', async () => {
    const backend = createMemoryBackend({ signedInAs: USER })
    const controller = createSyncController({ db, backend })
    let refreshed = false
    controller.subscribe(() => {
      refreshed = true
    })
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'] })

    const stop = controller.start()
    await vi.advanceTimersByTimeAsync(2500 + AUTO_SYNC_INTERVAL_MS)
    await vi.waitFor(() => expect(refreshed).toBe(true)) // the start-up check finished

    expect(controller.getSnapshot().lastResult).toBeNull()
    stop()
  })
})
