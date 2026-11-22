import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { db } from '../database/db'
import { createKeys, MIN_PBKDF2_ITERATIONS } from '../sync/crypto'
import { linkDevice } from '../sync/device'
import { createSyncController } from '../sync/syncController'
import { createMemoryBackend } from '../sync/testing/memoryBackend'
import { USAGE_EVENT as E } from '../screenTime/usageEvents'

import DeviceScreenTimeImportPanel from './DeviceScreenTimeImportPanel'

const t = (iso: string) => Date.parse(iso)

// A simulated phone (test timezone: America/New_York, UTC−5 in November).
const phone = vi.hoisted(() => ({
  granted: true,
  opened: 0,
  settingsOpened: 0,
  capture: { enabled: null as boolean | null, battery: false, started: 0 },
}))

vi.mock('../screenTime/usageStatsPlugin', () => ({
  hasUsageAccess: async () => phone.granted,
  openUsageAccessSettings: async () => {
    phone.opened += 1
  },
  readHistoryDepth: async () => ({ nowMs: Date.now(), earliestEventMs: t('2026-11-01T12:00:00Z') }),
  readUsageEvents: async () => ({
    packages: ['com.chat'],
    classes: ['Main'],
    events: [
      // 5 Nov and 6 Nov (New York): 1 h and 30 min.
      [t('2026-11-05T14:00:00Z'), E.ACTIVITY_RESUMED, 0, 0],
      [t('2026-11-05T15:00:00Z'), E.ACTIVITY_PAUSED, 0, 0],
      [t('2026-11-06T14:00:00Z'), E.ACTIVITY_RESUMED, 0, 0],
      [t('2026-11-06T14:30:00Z'), E.ACTIVITY_PAUSED, 0, 0],
    ],
  }),
  readHomePackages: async () => [],
  readAppLabels: async () => ({ 'com.chat': 'Chat' }),
  ensureUsageCapture: async () => {
    if (phone.granted && phone.capture.enabled !== false) {
      phone.capture.enabled = true
      phone.capture.started += 1
    }
  },
  startUsageCapture: async () => {
    phone.capture.enabled = true
  },
  stopUsageCapture: async () => {
    phone.capture.enabled = false
  },
  readCaptureStatus: async () => ({
    enabled: phone.capture.enabled,
    lastRunMs: Date.parse('2026-11-11T08:00:00Z'),
    coveredFromMs: Date.parse('2026-11-01T12:00:00Z'),
    batteryUnrestricted: phone.capture.battery,
  }),
  captureUsageNow: async () => undefined,
  // Saved copy: an app uninstalled since, used on 4 Nov (New York).
  readCapturedHistory: async () => ({
    events: {
      packages: ['com.gone'],
      classes: ['Main'],
      events: [
        [t('2026-11-04T14:00:00Z'), E.ACTIVITY_RESUMED, 0, 0],
        [t('2026-11-04T14:20:00Z'), E.ACTIVITY_PAUSED, 0, 0],
      ],
    },
    labels: { 'com.gone': 'Gone App' },
    covered: [{ startMs: t('2026-11-01T12:00:00Z'), endMs: Date.now() }],
  }),
  openAppSettings: async () => {
    phone.settingsOpened += 1
  },
}))

beforeEach(async () => {
  await db.delete()
  await db.open()
  phone.granted = true
  phone.opened = 0
  phone.settingsOpened = 0
  phone.capture = { enabled: null, battery: false, started: 0 }
})

afterEach(async () => {
  cleanup()
  db.close()
  await db.delete()
})

function count(label: string) {
  const row = screen.getByRole('rowheader', { name: label }).closest('tr') as HTMLElement
  return within(row).getAllByRole('cell')[0].textContent
}

describe('DeviceScreenTimeImportPanel', () => {
  it('asks for Usage access first and opens the phone settings', async () => {
    phone.granted = false
    render(<DeviceScreenTimeImportPanel controller={null} syncConfigured={false} onImported={vi.fn()} />)

    expect(await screen.findByText('off')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Check this phone for screen time' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Open Usage access settings' }))
    expect(phone.opened).toBe(1)

    phone.granted = true
    await userEvent.click(screen.getByRole('button', { name: 'Check again' }))
    expect(await screen.findByRole('button', { name: 'Check this phone for screen time' })).toBeInTheDocument()
  })

  it('previews, imports only after confirmation, and finds only known days next time', async () => {
    const onImported = vi.fn()
    render(<DeviceScreenTimeImportPanel controller={null} syncConfigured={false} onImported={onImported} />)

    await userEvent.click(await screen.findByRole('button', { name: 'Check this phone for screen time' }))

    // Days 2–10 Nov are complete; 1 Nov is incomplete; days without use are listed, not stored.
    // 4 Nov comes from the saved copy (app uninstalled since).
    expect(await screen.findByText(/3 complete days found, from 04\/11\/2026 to 06\/11\/2026, read as days in America\/New_York/)).toBeInTheDocument()
    expect(count('Will be imported')).toBe('3')
    expect(Number(count('Incomplete or empty days'))).toBeGreaterThan(1)
    expect(await db.externalSamples.count()).toBe(0)

    await userEvent.click(screen.getByRole('button', { name: 'Import 3 days' }))
    expect(await screen.findByText(/^Imported screen time for 3 days\./)).toBeInTheDocument()
    expect(onImported).toHaveBeenCalledTimes(1)
    const stored = await db.externalSamples.orderBy('startUtc').toArray()
    expect(stored.map((sample) => [sample.source, sample.metadata?.localDate, sample.value])).toEqual([
      ['android_usage', '2026-11-04', 1200],
      ['android_usage', '2026-11-05', 3600],
      ['android_usage', '2026-11-06', 1800],
    ])
    expect(stored[0].metadata?.apps).toEqual([{ name: 'Gone App', package: 'com.gone', seconds: 1200, opens: null }])

    await userEvent.click(screen.getByRole('button', { name: 'Check this phone for screen time' }))
    expect(await screen.findByText('Nothing new to import.')).toBeInTheDocument()
    expect(count('Already imported')).toBe('3')
  })

  it('on a synced phone: asks to sync first, then imports and sends the new days', async () => {
    const keys = await createKeys('correct horse battery staple', { iterations: MIN_PBKDF2_ITERATIONS })
    const backend = createMemoryBackend({ signedInAs: { id: 'user-1', email: 'me@example.com' }, envelope: keys.envelope })
    await linkDevice(db, { userId: 'user-1', dataKey: keys.dataKey, keyVersion: 1 })
    const controller = createSyncController({ db, backend })
    await controller.refresh()

    render(<DeviceScreenTimeImportPanel controller={controller} syncConfigured onImported={vi.fn()} />)

    expect(await screen.findByText(/Sync first/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Check this phone for screen time' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Sync now' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Check this phone for screen time' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Import 3 days' }))

    expect(await screen.findByRole('status')).toHaveTextContent(/^Imported screen time for 3 days\./)
    await vi.waitFor(() => expect(backend.server.rows()).toHaveLength(3))
  })

  it('starts automatic saving, shows its state, warns about battery limits and can be turned off', async () => {
    render(<DeviceScreenTimeImportPanel controller={null} syncConfigured={false} onImported={vi.fn()} />)

    expect(await screen.findByText(/Automatic saving:/)).toHaveTextContent(
      'Automatic saving: on · last saved 11/11/2026 03:00 · saved history from 01/11/2026',
    )
    expect(phone.capture.started).toBe(1)
    await userEvent.click(screen.getByRole('button', { name: 'Open app settings' }))
    expect(phone.settingsOpened).toBe(1)

    await userEvent.click(screen.getByRole('button', { name: 'Turn off automatic saving' }))
    expect(await screen.findByRole('button', { name: 'Turn on automatic saving' })).toBeInTheDocument()
    expect(screen.queryByText(/may stop PDA in the background/)).not.toBeInTheDocument()
    expect(phone.capture.enabled).toBe(false)
  })
})
