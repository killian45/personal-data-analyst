import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resetDeviceImportsCacheForTests, setDeviceImport } from '../settings/deviceImports'
import { resetAutoImportCacheForTests } from './autoImport'
import { useScreenTimeAutoImport } from './useScreenTimeAutoImport'

const phone = vi.hoisted(() => ({
  hasUsageAccess: vi.fn(async () => true),
  preview: vi.fn(async () => ({ toAdd: [] })),
}))

vi.mock('@capacitor/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@capacitor/core')>()
  return { ...actual, Capacitor: { ...actual.Capacitor, getPlatform: () => 'android' } }
})
vi.mock('./usageStatsPlugin', () => ({ hasUsageAccess: phone.hasUsageAccess }))
vi.mock('../import/deviceScreenTimeImport', () => ({ previewDeviceScreenTimeImport: phone.preview }))

beforeEach(() => {
  localStorage.clear()
  resetDeviceImportsCacheForTests()
  resetAutoImportCacheForTests()
  phone.hasUsageAccess.mockClear()
  phone.preview.mockClear()
})

afterEach(() => {
  cleanup()
})

function start() {
  renderHook(() => useScreenTimeAutoImport({ controller: null, syncConfigured: false, onImported: () => {} }))
}

describe('automatic screen-time import and the device switch', () => {
  it('runs when screen time is on for this device (default)', async () => {
    start()
    await waitFor(() => expect(phone.preview).toHaveBeenCalledTimes(1))
  })

  it('does not read the phone when screen time is turned off on this device', async () => {
    setDeviceImport('screenTime', false)
    start()
    // Give the start-up attempt time to finish.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(phone.hasUsageAccess).not.toHaveBeenCalled()
    expect(phone.preview).not.toHaveBeenCalled()
  })
})
