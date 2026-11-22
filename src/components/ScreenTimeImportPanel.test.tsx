import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { db } from '../database/db'
import { appUsageCsv } from '../import/testAppUsage'

import { ScreenTimeImportPanel } from './ScreenTimeImportPanel'

function csvFile(day: number, name = `AUM_V4_Usage_2026-11-${day + 1}.csv`) {
  const text = appUsageCsv({
    dateLine: `11/${day}/26`,
    title: `Usage history, November ${day}, 2026`,
    created: `Created by App Usage (PRO) on Monday, November ${day + 1}, 2026 at 02:01`,
  })
  return new File([text], name, { type: 'text/csv' })
}

function count(label: string) {
  const row = screen.getByRole('rowheader', { name: label }).closest('tr') as HTMLElement
  return within(row).getAllByRole('cell')[0].textContent
}

describe('ScreenTimeImportPanel', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(async () => {
    cleanup()
    db.close()
    await db.delete()
  })

  it('previews several files, then imports them after confirmation', async () => {
    const onImported = vi.fn()
    render(<ScreenTimeImportPanel onImported={onImported} />)

    // Test environment timezone: America/New_York (vite.config.ts).
    expect(screen.getByLabelText('Timezone of these days')).toHaveValue('America/New_York')

    const bad = new File(['hello'], 'notes.csv', { type: 'text/csv' })
    await userEvent.upload(screen.getByLabelText('Usage history files (.csv)'), [csvFile(8), csvFile(9), bad])

    expect(await screen.findByText(/3 files chosen: 2 days found, from 08\/11\/2026 to 09\/11\/2026, read as days in America\/New_York/)).toBeInTheDocument()
    expect(count('Will be imported')).toBe('2')
    expect(count('Invalid')).toBe('1')
    expect(screen.getByText(/notes\.csv: this is not an App Usage/)).toBeInTheDocument()
    expect(await db.externalSamples.count()).toBe(0)

    await userEvent.click(screen.getByRole('button', { name: 'Import 2 days' }))

    expect(await screen.findByText('Imported screen time for 2 days. 1 file(s) invalid and not imported.')).toBeInTheDocument()
    expect(await db.externalSamples.count()).toBe(2)
    expect(onImported).toHaveBeenCalledTimes(1)

    // Choosing the same files again finds only duplicates.
    await userEvent.upload(screen.getByLabelText('Usage history files (.csv)'), [csvFile(8), csvFile(9)])
    expect(await screen.findByText('Nothing new to import.')).toBeInTheDocument()
    expect(count('Skipped duplicates')).toBe('2')
  })

  it('reads the files again when the timezone changes, and Cancel writes nothing', async () => {
    render(<ScreenTimeImportPanel />)
    await userEvent.upload(screen.getByLabelText('Usage history files (.csv)'), [csvFile(9)])
    expect(await screen.findByText(/read as days in America\/New_York/)).toBeInTheDocument()

    const field = screen.getByLabelText('Timezone of these days')
    await userEvent.clear(field)
    expect(await screen.findByText(/Choose a valid timezone/)).toBeInTheDocument()
    await userEvent.type(field, 'Europe/Paris')
    expect(await screen.findByText(/read as days in Europe\/Paris/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByText(/read as days in/)).not.toBeInTheDocument()
    expect(await db.externalSamples.count()).toBe(0)
  })
})
