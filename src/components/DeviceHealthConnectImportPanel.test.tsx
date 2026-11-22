import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { db } from '../database/db'
import { createKeys, MIN_PBKDF2_ITERATIONS } from '../sync/crypto'
import { linkDevice } from '../sync/device'
import { createSyncController } from '../sync/syncController'
import { createMemoryBackend } from '../sync/testing/memoryBackend'
import DeviceHealthConnectImportPanel from './DeviceHealthConnectImportPanel'

// A simulated Health Connect on the phone.
const plugin = vi.hoisted(() => ({
  status: 'available' as 'available' | 'not-installed' | 'not-supported',
  permission: { sleep: true, history: true as boolean | null },
  records: [] as unknown[],
}))

vi.mock('../import/healthConnectPlugin', () => ({
  healthConnectStatus: async () => plugin.status,
  checkSleepPermission: async () => plugin.permission,
  requestSleepPermission: async () => plugin.permission,
  readAllSleepSessions: async () => plugin.records,
}))

function night(id: string, start: string, end: string) {
  return {
    metadata: { id, clientRecordVersion: 0, lastModifiedTime: '2026-11-10T08:00:00Z', dataOrigin: 'com.example.sleep' },
    startTime: start,
    startZoneOffset: '+01:00',
    endTime: end,
    endZoneOffset: '+01:00',
    stages: [{ startTime: start, endTime: end, stage: 4 }],
  }
}

beforeEach(async () => {
  await db.delete()
  await db.open()
  plugin.status = 'available'
  plugin.permission = { sleep: true, history: true }
  plugin.records = [
    night('aaaaaaaa-0000-4000-8000-000000000001', '2026-11-08T22:00:00Z', '2026-11-09T06:00:00Z'),
    night('aaaaaaaa-0000-4000-8000-000000000002', '2026-11-09T22:30:00Z', '2026-11-10T06:30:00Z'),
  ]
})

afterEach(async () => {
  cleanup()
  db.close()
  await db.delete()
})

describe('DeviceHealthConnectImportPanel', () => {
  it('previews, imports only after confirmation, and skips known nights next time', async () => {
    const onImported = vi.fn()
    render(<DeviceHealthConnectImportPanel controller={null} syncConfigured={false} onImported={onImported} />)

    await userEvent.click(screen.getByRole('button', { name: 'Check Health Connect for sleep' }))
    expect(await screen.findByRole('button', { name: 'Import 2 sleep sessions' })).toBeInTheDocument()
    expect(await db.sleepSessions.count()).toBe(0) // nothing written by the preview

    await userEvent.click(screen.getByRole('button', { name: 'Import 2 sleep sessions' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Imported 2 sleep sessions.')
    expect(await db.sleepSessions.count()).toBe(2)
    expect(onImported).toHaveBeenCalled()

    // Running it again: nothing new.
    await userEvent.click(screen.getByRole('button', { name: 'Check Health Connect for sleep' }))
    expect(await screen.findByText('Nothing new to import.')).toBeInTheDocument()
  })

  it('explains a refused permission and reads nothing', async () => {
    plugin.permission = { sleep: false, history: null }
    render(<DeviceHealthConnectImportPanel controller={null} syncConfigured={false} onImported={vi.fn()} />)

    await userEvent.click(screen.getByRole('button', { name: 'Check Health Connect for sleep' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Permission to read sleep was not given')
  })

  it('explains when Health Connect is missing', async () => {
    plugin.status = 'not-installed'
    render(<DeviceHealthConnectImportPanel controller={null} syncConfigured={false} onImported={vi.fn()} />)

    await userEvent.click(screen.getByRole('button', { name: 'Check Health Connect for sleep' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Health Connect is not installed')
  })

  it('on a synced phone: asks to sync first, then allows the import and sends the new nights', async () => {
    const keys = await createKeys('correct horse battery staple', { iterations: MIN_PBKDF2_ITERATIONS })
    const backend = createMemoryBackend({ signedInAs: { id: 'user-1', email: 'me@example.com' }, envelope: keys.envelope })
    await linkDevice(db, { userId: 'user-1', dataKey: keys.dataKey, keyVersion: 1 })
    const controller = createSyncController({ db, backend })
    await controller.refresh()

    render(<DeviceHealthConnectImportPanel controller={controller} syncConfigured onImported={vi.fn()} />)

    expect(screen.getByText(/Sync first/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Check Health Connect for sleep' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Sync now' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Check Health Connect for sleep' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Import 2 sleep sessions' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Imported 2 sleep sessions.')
    await vi.waitFor(() => expect(backend.server.rows()).toHaveLength(2))
  })

  it('waits while the sync code is still loading', () => {
    render(<DeviceHealthConnectImportPanel controller={null} syncConfigured onImported={vi.fn()} />)
    expect(screen.getByText('Loading sync…')).toBeInTheDocument()
  })
})
