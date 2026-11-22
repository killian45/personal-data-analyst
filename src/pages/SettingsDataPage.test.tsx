import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getDeviceImports, resetDeviceImportsCacheForTests } from '../settings/deviceImports'
import { DEFAULT_DISPLAY_TIMEZONE } from '../settings/displayTimezone'
import { SettingsDataPage } from './SettingsDataPage'

// Which platform the page thinks it runs on, and the phone's background capture.
const platform = vi.hoisted(() => ({ name: 'android', stopCapture: vi.fn(async () => {}) }))

vi.mock('@capacitor/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@capacitor/core')>()
  return { ...actual, Capacitor: { ...actual.Capacitor, getPlatform: () => platform.name } }
})
vi.mock('../screenTime/usageStatsPlugin', () => ({ stopUsageCapture: platform.stopCapture }))

// The import panels themselves are tested elsewhere; here only whether they are shown.
function stub(name: string) {
  return () => <p>{`[${name}]`}</p>
}
vi.mock('../components/DeviceHealthConnectImportPanel', () => ({ default: stub('phone sleep') }))
vi.mock('../components/HealthDataImportPanel', () => ({ default: stub('phone activity') }))
vi.mock('../components/DeviceScreenTimeImportPanel', () => ({ default: stub('phone screen time') }))
vi.mock('../components/crm/PhoneContactImportPanel', () => ({ default: stub('phone contacts') }))
vi.mock('../components/YnabPanel', () => ({ default: stub('ynab') }))
vi.mock('../components/SyncPanel', () => ({ SyncPanel: stub('sync') }))
vi.mock('../components/HealthConnectImportPanel', () => ({ HealthConnectImportPanel: stub('health connect file') }))
vi.mock('../components/ScreenTimeImportPanel', () => ({ ScreenTimeImportPanel: stub('screen time file') }))
vi.mock('../components/TimelineImportPanel', () => ({ TimelineImportPanel: stub('location file') }))
vi.mock('../components/HabitImportPanel', () => ({ HabitImportPanel: stub('spreadsheet') }))
vi.mock('../components/ExportPanel', () => ({ ExportPanel: stub('export') }))
vi.mock('../components/DataBackupPanel', () => ({ DataBackupPanel: stub('backup') }))
vi.mock('../components/RestoreBackupPanel', () => ({ RestoreBackupPanel: stub('restore') }))
vi.mock('../components/DeletedDataPanel', () => ({ DeletedDataPanel: stub('deleted') }))
vi.mock('../components/DeleteAllDataPanel', () => ({ DeleteAllDataPanel: stub('delete all') }))
vi.mock('../components/DisplayTimezoneSettings', () => ({ DisplayTimezoneSettings: stub('timezone') }))
vi.mock('../components/SleepTargetsSettings', () => ({ SleepTargetsSettings: stub('sleep targets') }))

function renderPage() {
  return render(
    <SettingsDataPage
      syncBackend={null}
      syncController={null}
      displayTimezone={DEFAULT_DISPLAY_TIMEZONE}
      setDisplayTimezone={() => {}}
      restoreCount={0}
      setRestoreCount={() => {}}
      reloadAfterExternalChange={() => {}}
      loadHabits={async () => {}}
      loadActiveTimers={async () => {}}
    />,
  )
}

const ALL_IMPORT_PANELS = [
  '[phone sleep]', '[phone activity]', '[phone screen time]', '[phone contacts]',
  '[health connect file]', '[screen time file]', '[location file]',
]

beforeEach(() => {
  localStorage.clear()
  resetDeviceImportsCacheForTests()
  platform.name = 'android'
  platform.stopCapture.mockClear()
})

afterEach(() => {
  cleanup()
})

describe('What this device imports (Android app)', () => {
  it('starts with everything on and every import panel shown', async () => {
    renderPage()
    expect(screen.getByRole('heading', { name: 'What this device imports' })).toBeInTheDocument()
    for (const name of ALL_IMPORT_PANELS) expect(await screen.findByText(name)).toBeInTheDocument()
    expect(screen.getByText(/Screen time:/)).toHaveTextContent('Screen time: on')
  })

  it('turning Health Connect off hides its sleep, activity and file panels only', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: 'Turn off Health Connect (sleep, activity and heart)' }))

    expect(screen.queryByText('[phone sleep]')).not.toBeInTheDocument()
    expect(screen.queryByText('[phone activity]')).not.toBeInTheDocument()
    expect(screen.queryByText('[health connect file]')).not.toBeInTheDocument()
    expect(screen.getByText(/Health Connect \(sleep, activity and heart\): import is turned off on this device/)).toBeInTheDocument()
    expect(await screen.findByText('[phone screen time]')).toBeInTheDocument()
    expect(screen.getByText('[location file]')).toBeInTheDocument()
    expect(screen.getByText('[phone contacts]')).toBeInTheDocument()
    expect(getDeviceImports().healthConnect).toBe(false)
    expect(platform.stopCapture).not.toHaveBeenCalled()
  })

  it('turning screen time off hides its panels and stops the background saving', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: 'Turn off Screen time' }))

    expect(screen.queryByText('[phone screen time]')).not.toBeInTheDocument()
    expect(screen.queryByText('[screen time file]')).not.toBeInTheDocument()
    expect(platform.stopCapture).toHaveBeenCalledTimes(1)

    // Turning it back on shows the panels again (nothing is restarted by itself).
    await user.click(screen.getByRole('button', { name: 'Turn on Screen time' }))
    expect(await screen.findByText('[phone screen time]')).toBeInTheDocument()
    expect(screen.getByText('[screen time file]')).toBeInTheDocument()
    expect(platform.stopCapture).toHaveBeenCalledTimes(1)
  })

  it('shows an error when the background saving cannot be stopped', async () => {
    platform.stopCapture.mockRejectedValueOnce(new Error('plugin failed'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: 'Turn off Screen time' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('background saving could not be stopped')
    expect(getDeviceImports().screenTime).toBe(false)
  })

  it('location and contacts switches hide their panels; the choice survives a restart', async () => {
    const user = userEvent.setup()
    const { unmount } = renderPage()
    await user.click(screen.getByRole('button', { name: 'Turn off Location history' }))
    await user.click(screen.getByRole('button', { name: 'Turn off Contacts' }))
    unmount()

    resetDeviceImportsCacheForTests()
    renderPage()
    expect(await screen.findByText('[phone sleep]')).toBeInTheDocument()
    expect(screen.queryByText('[location file]')).not.toBeInTheDocument()
    expect(screen.queryByText('[phone contacts]')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Turn on Location history' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Turn on Contacts' })).toBeInTheDocument()
    expect(screen.getByText(/Location history: import is turned off/)).toBeInTheDocument()
    expect(screen.getByText(/Contacts: import is turned off/)).toBeInTheDocument()
  })
})

describe('computer app', () => {
  it('has no switches and keeps every file import, even if switches were saved', async () => {
    localStorage.setItem('pda.deviceImports', JSON.stringify({ location: false, screenTime: false, healthConnect: false, contacts: false }))
    platform.name = 'web'
    renderPage()
    expect(screen.queryByRole('heading', { name: 'What this device imports' })).not.toBeInTheDocument()
    expect(screen.getByText('[health connect file]')).toBeInTheDocument()
    expect(screen.getByText('[screen time file]')).toBeInTheDocument()
    expect(screen.getByText('[location file]')).toBeInTheDocument()
    expect(screen.queryByText('[phone sleep]')).not.toBeInTheDocument()
  })
})
