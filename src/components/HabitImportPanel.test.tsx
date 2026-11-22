import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { db } from '../database/db'
import { createHabit } from '../database/habits'

import { HabitImportPanel } from './HabitImportPanel'

// Made-up data only. Paris times: 13/11 23:30 → 00:45 = 1 h 15 min.
const SHEET = [
  'Date\tStart\tStop\tDose time\tDose (mg)',
  '13/11/2026\t23:30\t00:45\t13/11/2026 08:00\t2,5',
  '14/11/2026\t22:00\t23:00\t\t',
  '15/11/2026\t21:00\t\t15/11/2026 09:00\t1,000',
].join('\n')

async function pick(user: ReturnType<typeof userEvent.setup>, label: string, option: string) {
  await within(await screen.findByLabelText(label)).findByRole('option', { name: option })
  await user.selectOptions(screen.getByLabelText(label), within(screen.getByLabelText(label)).getByRole('option', { name: option }))
}

describe('HabitImportPanel', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })
  afterEach(async () => {
    cleanup()
    db.close()
    await db.delete()
  })

  it('imports a stopwatch habit from pasted cells after a preview, then undoes the import', async () => {
    await createHabit({ name: 'Walk', type: 'stopwatch' })
    const onImported = vi.fn()
    const user = userEvent.setup()
    const { container } = render(<HabitImportPanel onImported={onImported} />)
    // Pasting only: the CSV file option was removed (user decision 2026-11-21).
    expect(container.querySelector('input[type="file"]')).toBeNull()

    await pick(user, '1. Habit to import into', 'Walk (stopwatch)')
    fireEvent.change(screen.getByLabelText(/paste cells/i), { target: { value: SHEET } })
    expect(screen.getByText(/4 rows read/)).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Automatic (tab)' })).toBeInTheDocument()

    await pick(user, 'Start date (or date and time)', 'Date (column A)')
    await pick(user, 'Start time', 'Start (column B)')
    await pick(user, 'Stop date (or date and time)', 'Date (column A)')
    await pick(user, 'Stop time', 'Stop (column C)')
    fireEvent.change(screen.getByLabelText('Timezone of the times in the sheet'), { target: { value: 'Europe/Paris' } })

    const preview = screen.getByLabelText('Import preview')
    expect(within(preview).getByText('ready to import')).toHaveTextContent('2 ready to import')
    expect(within(preview).getByText(/Row 4: Stop: a time is needed/)).toBeInTheDocument()
    expect(within(preview).getByText('1 h 15 min')).toBeInTheDocument()
    expect(within(preview).getByText('14/11/2026 00:45')).toBeInTheDocument()

    const importButton = within(preview).getByRole('button', { name: 'Import 2 entries into "Walk"' })
    expect(importButton).toBeDisabled() // a row has a problem: must be accepted first
    await user.click(within(preview).getByLabelText(/Import the 2 ready entries only/))
    await user.click(importButton)

    expect(await screen.findByText('2 entries imported into "Walk".')).toBeInTheDocument()
    expect(onImported).toHaveBeenCalledTimes(1)
    const saved = (await db.entries.toArray()).sort((a, b) => a.occurredStart.localeCompare(b.occurredStart))
    expect(saved.map((e) => [e.source, e.occurredStart, e.occurredEnd, e.timezone])).toEqual([
      ['import', '2026-11-13T22:30:00.000Z', '2026-11-13T23:45:00.000Z', 'Europe/Paris'],
      ['import', '2026-11-14T21:00:00.000Z', '2026-11-14T22:00:00.000Z', 'Europe/Paris'],
    ])
    // The same rows are now recognised as already in the app.
    await waitFor(() => expect(within(preview).getByText('already in the app (skipped)')).toHaveTextContent('2 already in the app'))

    await user.click(screen.getByRole('button', { name: 'Undo this import' }))
    expect(await screen.findByText(/Import undone: 2 entries deleted/)).toBeInTheDocument()
    expect((await db.entries.toArray()).every((e) => e.deletedAt !== null)).toBe(true)
  })

  it('imports doses into a number habit from the same sheet; empty rows are counted, ambiguous numbers flagged', async () => {
    await createHabit({ name: 'Dose', type: 'number', unit: 'mg' })
    const user = userEvent.setup()
    render(<HabitImportPanel onImported={() => undefined} />)
    await pick(user, '1. Habit to import into', 'Dose (number)')
    fireEvent.change(screen.getByLabelText(/paste cells/i), { target: { value: SHEET } })
    await pick(user, 'Value (mg)', 'Dose (mg) (column E)')
    await pick(user, 'Date (or date and time)', 'Dose time (column D)')
    fireEvent.change(screen.getByLabelText('Timezone of the times in the sheet'), { target: { value: 'Europe/Paris' } })

    const preview = screen.getByLabelText('Import preview')
    expect(within(preview).getByText('ready to import')).toHaveTextContent('1 ready to import')
    expect(within(preview).getByText('empty for these columns')).toHaveTextContent('1 empty')
    expect(within(preview).getByText(/Row 4: "1,000" is ambiguous/)).toBeInTheDocument()
    expect(within(preview).getByText('2.5 mg')).toBeInTheDocument()
  })
})
