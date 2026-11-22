import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from './App'
import { db } from './database/db'
import { createEntry } from './database/entries'
import { createHabit } from './database/habits'

/**
 * Whole-application tests: they check that the pages are connected to
 * the main navigation, not only that each component works on its own.
 */
describe('App navigation', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(async () => {
    cleanup()
    db.close()
    await db.delete()
  })

  it('shows an entry logged in Data Logging on the Personal Data Log page', async () => {
    await createHabit({ name: 'Water', type: 'number', unit: 'ml' })

    render(<App />)

    // Data Logging is the start page.
    const input = await screen.findByLabelText('Value for Water')
    await userEvent.type(input, '750{Enter}')
    expect(await screen.findByText(/^Saved for/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Personal Data Log' }))

    expect(screen.queryByText(/will be implemented/)).not.toBeInTheDocument()
    expect(await screen.findByText('Showing 1–1 of 1 entry')).toBeInTheDocument()

    const [, body] = screen.getAllByRole('rowgroup')
    const [row] = within(body).getAllByRole('row')

    expect(row).toHaveTextContent('Water')
    expect(row).toHaveTextContent('750')
    expect(row).toHaveTextContent('ml')
  })

  it('shows the empty state on the Personal Data Log page without entries', async () => {
    render(<App />)

    await userEvent.click(screen.getByRole('button', { name: 'Personal Data Log' }))

    expect(
      await screen.findByText('No entries yet. Log your first entry in Data Logging.'),
    ).toBeInTheDocument()
  })

  it('opens the Settings & Data page', async () => {
    render(<App />)

    await userEvent.click(screen.getByRole('button', { name: 'Settings & Data' }))

    expect(screen.getByRole('button', { name: 'Download backup (JSON)' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Display timezone' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Paste habit entries from a spreadsheet' })).toBeInTheDocument()
  })

  it('shows the log in the display timezone chosen in Settings', async () => {
    const water = await createHabit({ name: 'Water', type: 'number' })
    // 23:00 UTC = 08:00 the next day in Tokyo, 00:00 the next day in Paris
    await createEntry({
      habitId: water.id,
      value: 1,
      occurredStart: '2026-11-08T23:00:00.000Z',
      timezone: 'Asia/Tokyo',
    })

    render(<App />)

    await userEvent.click(screen.getByRole('button', { name: 'Personal Data Log' }))
    const [, body] = await screen.findAllByRole('rowgroup')
    expect(within(body).getByRole('row')).toHaveTextContent('08:00')
    expect(screen.getByText(/Times shown in the timezone where each entry happened/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Settings & Data' }))
    await userEvent.click(screen.getByLabelText(/Always one timezone/))

    const zone = screen.getByLabelText('Timezone')
    await userEvent.clear(zone)
    await userEvent.type(zone, 'Europe/Paris')
    await userEvent.click(screen.getByRole('button', { name: 'Save display timezone' }))

    expect(await screen.findByText('Display timezone saved.')).toBeInTheDocument()
    expect((await db.settings.get('displayTimezone'))?.value).toBe('Europe/Paris')

    await userEvent.click(screen.getByRole('button', { name: 'Personal Data Log' }))

    expect(await screen.findByText(/Times shown in Europe\/Paris/)).toBeInTheDocument()
    const [, newBody] = screen.getAllByRole('rowgroup')
    const row = within(newBody).getByRole('row')
    expect(row).toHaveTextContent('Mon 9 Nov 2026')
    expect(row).toHaveTextContent('00:00')
    expect(row).toHaveTextContent('recorded in Asia/Tokyo')
  })

  it('edits, deletes and restores an entry from the Personal Data Log page', async () => {
    await createHabit({ name: 'Water', type: 'number', unit: 'ml' })

    render(<App />)

    await userEvent.type(await screen.findByLabelText('Value for Water'), '500{Enter}')
    await screen.findByText(/^Saved for/)

    await userEvent.click(screen.getByRole('button', { name: 'Personal Data Log' }))
    await userEvent.click(await screen.findByRole('button', { name: /^Edit Water/ }))

    const value = screen.getByLabelText('Value (ml)')
    await userEvent.clear(value)
    await userEvent.type(value, '600')
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByText('Entry updated.')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /^Delete Water/ }))
    expect(await screen.findByText('No entries yet. Log your first entry in Data Logging.')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(await screen.findByText('Showing 1–1 of 1 entry')).toBeInTheDocument()
    expect(screen.getByText('600')).toBeInTheDocument()
  })

  it('edits the start and end of a session logged with "Log a past session"', async () => {
    await createHabit({ name: 'Reading', type: 'stopwatch' })

    render(<App />)

    await userEvent.click(await screen.findByRole('button', { name: 'Log a past session' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save session' }))
    await screen.findByText(/^Saved a 1 h 00 min session/)

    await userEvent.click(screen.getByRole('button', { name: 'Personal Data Log' }))
    await userEvent.click(await screen.findByRole('button', { name: /^Edit Reading/ }))

    expect(screen.getByLabelText('Start: time (24-hour)')).toBeInTheDocument()
    expect(screen.getByLabelText('End: time (24-hour)')).toBeInTheDocument()
  })

  it('offers a plain start and stop stopwatch without pause', async () => {
    await createHabit({ name: 'Reading', type: 'stopwatch' })

    render(<App />)

    await userEvent.click(await screen.findByRole('button', { name: 'Start stopwatch' }))

    expect(await screen.findByRole('button', { name: 'Stop and save' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel timer' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Pause' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Resume' })).not.toBeInTheDocument()
  })

  it('restores a deleted habit and a deleted entry from Settings & Data', async () => {
    const water = await createHabit({ name: 'Water', type: 'number' })
    await createHabit({ name: 'Gym', type: 'checkbox' })
    await createEntry({ habitId: water.id, value: 7, occurredStart: '2026-11-09T08:00:00.000Z' })
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(<App />)

    // Delete the Gym habit on Data Logging.
    await screen.findByText('Gym')
    const gymCard = screen.getByText('Gym').closest('article') as HTMLElement
    await userEvent.click(within(gymCard).getByRole('button', { name: 'Delete' }))
    await screen.findByText('Habit deleted.')
    expect(screen.queryByText('Gym')).not.toBeInTheDocument()

    // Delete the Water entry in the Personal Data Log.
    await userEvent.click(screen.getByRole('button', { name: 'Personal Data Log' }))
    await userEvent.click(await screen.findByRole('button', { name: /^Delete Water/ }))
    await screen.findByText('No entries yet. Log your first entry in Data Logging.')

    // Restore both in Settings & Data.
    await userEvent.click(screen.getByRole('button', { name: 'Settings & Data' }))
    // Deleted data is a closed section until the user opens it.
    const deletedSection = (await screen.findByText('Deleted data', { selector: 'summary span' })).closest('details')
    expect(deletedSection?.open).toBe(false)
    await userEvent.click(screen.getByText('Deleted data', { selector: 'summary span' }))
    expect(deletedSection?.open).toBe(true)
    await userEvent.click(await screen.findByRole('button', { name: 'Restore habit Gym' }))
    await screen.findByText('Restored: Gym.')
    await userEvent.click(screen.getByRole('button', { name: /^Restore entry Water/ }))
    await screen.findByText(/^Restored: Water/)

    await userEvent.click(screen.getByRole('button', { name: 'Personal Data Log' }))
    expect(await screen.findByText('Showing 1–1 of 1 entry')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Data Logging' }))
    expect(await screen.findByText('Gym')).toBeInTheDocument()

    vi.restoreAllMocks()
  })

  it('restores a backup from Settings & Data into an empty database', async () => {
    const water = await createHabit({ name: 'Water', type: 'number', unit: 'ml' })
    await createEntry({ habitId: water.id, value: 750, occurredStart: '2026-11-09T08:00:00.000Z' })

    const { createBackup, serializeBackup } = await import('./backup/backup')
    const text = serializeBackup(await createBackup())

    await db.transaction('rw', db.tables, async () => {
      for (const table of db.tables) {
        await table.clear()
      }
    })

    render(<App />)

    expect(await screen.findByText('No habits yet. Create your first habit using the form.')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Settings & Data' }))
    await userEvent.upload(
      screen.getByLabelText('Backup file (.json)'),
      new File([text], 'pda-backup.json', { type: 'application/json' }),
    )
    await userEvent.click(await screen.findByRole('button', { name: 'Restore 2 records' }))
    expect(await screen.findByText('Restored 2 records.')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Data Logging' }))
    expect(await screen.findByLabelText('Value for Water')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Personal Data Log' }))
    expect(await screen.findByText('Showing 1–1 of 1 entry')).toBeInTheDocument()
    expect(screen.getByText('750')).toBeInTheDocument()
  })

  it('logs sleep on Data Logging and shows it in the Personal Data Log', async () => {
    render(<App />)

    await userEvent.click(await screen.findByRole('button', { name: 'Log sleep' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save sleep' }))
    expect(await screen.findByText(/^Saved: .* \(8 h 00 min in bed\)\.$/)).toBeInTheDocument()
    expect(await db.sleepSessions.count()).toBe(1)

    await userEvent.click(screen.getByRole('button', { name: 'Personal Data Log' }))
    expect(await screen.findByText('8 h 00 min in bed')).toBeInTheDocument()
  })

  it('creates a number habit with a daily average and a target', async () => {
    render(<App />)

    await userEvent.type(await screen.findByLabelText('Habit name'), 'Weight')
    await userEvent.type(screen.getByLabelText('Unit (optional)'), 'kg')
    await userEvent.selectOptions(screen.getByLabelText('Daily value'), 'mean')
    await userEvent.type(screen.getByLabelText('Daily target (optional)'), '72,5')
    await userEvent.click(screen.getByRole('button', { name: 'Create habit' }))

    expect(await screen.findByText('Habit created successfully.')).toBeInTheDocument()
    expect(screen.getByText(/daily average · target 72.5 kg/)).toBeInTheDocument()
    expect((await db.habits.toArray())[0]).toMatchObject({ dailyAggregation: 'mean', target: 72.5 })
  })

  it('refuses a target that is not a number', async () => {
    render(<App />)

    await userEvent.type(await screen.findByLabelText('Habit name'), 'Water')
    await userEvent.type(screen.getByLabelText('Daily target (optional)'), 'lots')
    await userEvent.click(screen.getByRole('button', { name: 'Create habit' }))

    expect(await screen.findByText('The target must be a number, for example 2.5 or 2,5.')).toBeInTheDocument()
    expect(await db.habits.count()).toBe(0)
  })

  it('saves sleep targets in Settings & Data', async () => {
    render(<App />)

    await userEvent.click(screen.getByRole('button', { name: 'Settings & Data' }))
    await userEvent.type(await screen.findByLabelText('Sleep duration'), '7:30')
    await userEvent.type(screen.getByLabelText('Bedtime'), '23:00')
    await userEvent.click(screen.getByRole('button', { name: 'Save sleep targets' }))

    expect(await screen.findByText('Sleep targets saved.')).toBeInTheDocument()
    expect((await db.settings.get('target.bedtime'))?.value).toBe('23:00')
  })

  it('opens the Dashboard through the navigation and shows logged sleep', async () => {
    render(<App />)

    await userEvent.click(await screen.findByRole('button', { name: 'Log sleep' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save sleep' }))
    await screen.findByText(/^Saved: /)

    await userEvent.click(screen.getByRole('button', { name: 'Dashboard' }))

    // The Dashboard computes every metric on first load; allow for a busy
    // machine (the default 1 s wait failed when tests ran under load).
    const sleep = await screen.findByRole('region', { name: 'Sleep duration' }, { timeout: 5000 })
    expect(within(sleep).getByText('Nights with data', { selector: 'dt' }).nextSibling).toHaveTextContent('1')
    expect(screen.queryByText(/will be implemented/)).not.toBeInTheDocument()
  })

  it('exports data from Settings & Data', async () => {
    const water = await createHabit({ name: 'Water', type: 'number' })
    await createEntry({ habitId: water.id, value: 1, occurredStart: '2026-11-09T08:00:00.000Z' })
    URL.createObjectURL = vi.fn(() => 'blob:test')
    URL.revokeObjectURL = vi.fn()
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    render(<App />)

    await userEvent.click(screen.getByRole('button', { name: 'Settings & Data' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Download export' }))

    expect(await screen.findByText(/^Export downloaded: 1 habit entries/)).toBeInTheDocument()
    vi.restoreAllMocks()
  })

  it('imports a Health Connect export and shows the nights on the Dashboard', async () => {
    const { buildHealthConnectDb } = await import('./import/testHealthConnect')
    const bytes = await buildHealthConnectDb([
      { start: '2026-11-08T22:00:00.000Z', end: '2026-11-09T06:00:00.000Z' },
    ])

    render(<App />)

    await userEvent.click(screen.getByRole('button', { name: 'Settings & Data' }))
    await userEvent.upload(
      await screen.findByLabelText('Health Connect export (.zip)'),
      new File([bytes as BlobPart], 'health_connect_export.db'),
    )
    await userEvent.click(await screen.findByRole('button', { name: 'Import 1 sleep session' }))
    expect(await screen.findByText('Imported 1 sleep session.')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Personal Data Log' }))
    expect(await screen.findByText('Health Connect')).toBeInTheDocument()
  })
})
