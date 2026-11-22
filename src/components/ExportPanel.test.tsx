import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { db } from '../database/db'
import { createEntry } from '../database/entries'
import { createHabit } from '../database/habits'
import { createManualSleepSession } from '../database/sleepSessions'

import { ExportPanel } from './ExportPanel'

describe('ExportPanel', () => {
  let blobs: Blob[]

  beforeEach(async () => {
    await db.delete()
    await db.open()
    blobs = []
    URL.createObjectURL = vi.fn((blob: Blob) => {
      blobs.push(blob)
      return 'blob:test'
    })
    URL.revokeObjectURL = vi.fn()
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    const water = await createHabit({ name: 'Water', type: 'number', unit: 'ml' })
    const gym = await createHabit({ name: 'Gym', type: 'checkbox' })
    await createEntry({ habitId: water.id, value: 500, occurredStart: '2026-11-09T08:00:00.000Z' })
    await createEntry({ habitId: gym.id, value: true, occurredStart: '2026-11-09T18:00:00.000Z' })
    await createManualSleepSession({ startUtc: '2026-11-08T22:30:00Z', endUtc: '2026-11-09T06:00:00Z' })
  })

  afterEach(async () => {
    cleanup()
    vi.restoreAllMocks()
    db.close()
    await db.delete()
  })

  it('downloads an Excel workbook by default and reports what it contains', async () => {
    render(<ExportPanel />)

    await userEvent.click(screen.getByRole('button', { name: 'Download export' }))

    expect(await screen.findByText(
      'Export downloaded: 2 habit entries, 1 sleep sessions (recorded), 1 nights and naps (calculated), 0 screen time per day, 0 screen time per app.',
    )).toBeInTheDocument()
    expect(blobs).toHaveLength(1)
    expect(blobs[0].type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  })

  it('offers one CSV download button per data type, each creating one file', async () => {
    render(<ExportPanel />)

    await userEvent.click(screen.getByLabelText(/^CSV/))

    expect(screen.queryByRole('button', { name: 'Download export' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /^Download CSV/ }).map((b) => b.textContent)).toEqual([
      'Download CSV: Habit entries',
      'Download CSV: Sleep sessions (recorded)',
      'Download CSV: Nights and naps (calculated)',
      'Download CSV: Screen time per day',
      'Download CSV: Screen time per app',
    ])

    await userEvent.click(screen.getByRole('button', { name: 'Download CSV: Habit entries' }))
    expect(await screen.findByText('Export downloaded: 2 habit entries.')).toBeInTheDocument()
    expect(blobs).toHaveLength(1)
    expect(await blobs[0].text()).toContain('Water')

    await userEvent.click(screen.getByRole('button', { name: 'Download CSV: Sleep sessions (recorded)' }))
    expect(await screen.findByText('Export downloaded: 1 sleep sessions (recorded).')).toBeInTheDocument()
    expect(blobs).toHaveLength(2)
    expect(await blobs[1].text()).toContain('Bedtime date')
  })

  it('only offers CSV buttons for the chosen data types', async () => {
    render(<ExportPanel />)

    await userEvent.click(screen.getByLabelText(/^CSV/))
    await userEvent.click(screen.getByLabelText('Nights and naps (calculated)'))
    await userEvent.click(screen.getByLabelText('Screen time per app'))

    expect(screen.getAllByRole('button', { name: /^Download CSV/ })).toHaveLength(3)
  })

  it('exports only the chosen habits and date range', async () => {
    render(<ExportPanel />)

    await userEvent.click(screen.getByLabelText(/^Markdown/))
    await userEvent.click(screen.getByLabelText('Sleep sessions (recorded)'))
    await userEvent.click(screen.getByLabelText('Nights and naps (calculated)'))
    await userEvent.click(screen.getByLabelText('Screen time per day'))
    await userEvent.click(screen.getByLabelText('Screen time per app'))
    await userEvent.click(screen.getByLabelText('All habits'))
    await userEvent.click(await screen.findByLabelText(/Gym/))
    await userEvent.type(screen.getByLabelText('Export from'), '09/11/2026')
    await userEvent.type(screen.getByLabelText('Export to'), '09/11/2026')
    await userEvent.click(screen.getByRole('button', { name: 'Download export' }))

    expect(await screen.findByText('Export downloaded: 1 habit entries.')).toBeInTheDocument()
    const markdown = await blobs[0].text()
    expect(markdown).toContain('- Habits: Gym')
    expect(markdown).toContain('- Date range: 2026-11-09 to 2026-11-09 (inclusive)')
    expect(markdown).not.toContain('| Water |')
  })

  it('explains invalid choices instead of exporting', async () => {
    render(<ExportPanel />)

    await userEvent.type(screen.getByLabelText('Export from'), '09/11/2026')
    await userEvent.click(screen.getByRole('button', { name: 'Download export' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Enter both dates (dd/mm/yyyy), or leave both empty')

    await userEvent.clear(screen.getByLabelText('Export from'))
    for (const label of ['Habit entries', 'Sleep sessions (recorded)', 'Nights and naps (calculated)', 'Screen time per day', 'Screen time per app']) {
      await userEvent.click(screen.getByLabelText(label))
    }
    await userEvent.click(screen.getByRole('button', { name: 'Download export' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Choose at least one kind of data to export.')
    expect(blobs).toHaveLength(0)
  })
})
