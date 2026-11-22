import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { Measure } from '../../analysis/measures'
import { db } from '../../database/db'
import type { FormulaDefinition } from '../../formulas/formulas'
import { loadFormulas } from '../../formulas/formulas'

import { FormulaManager } from './FormulaManager'

const measures: Measure[] = [
  { id: 'sleep:duration', label: 'Sleep duration', group: 'Sleep', kind: 'duration', unit: null, per: 'night', daily: [{ date: '2026-11-01', value: 7.5 }, { date: '2026-11-02', value: 6 }] },
  { id: 'screenTime', label: 'Screen time', group: 'Screen time', kind: 'duration', unit: null, per: 'day', daily: [{ date: '2026-11-01', value: 2 }, { date: '2026-11-02', value: 7 }] },
]

function setup(initial: FormulaDefinition[] = []) {
  let current = initial
  const view = render(<FormulaManager measures={measures} formulas={current} onChange={(list) => { current = list; view.rerender(<FormulaManager measures={measures} formulas={current} onChange={() => {}} />) }} />)
  return { get current() { return current } }
}

describe('FormulaManager', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(async () => {
    cleanup()
    db.close()
    await db.delete()
  })

  it('creates a formula with inserted measures, a live preview and validation messages', async () => {
    setup()
    await userEvent.click(screen.getByRole('button', { name: 'New formula' }))
    await userEvent.type(screen.getByLabelText('Name'), 'Sleep minus screens')

    await userEvent.selectOptions(screen.getByLabelText('Insert a measure'), 'Sleep duration')
    await userEvent.click(screen.getByRole('button', { name: 'Insert' }))
    await userEvent.type(screen.getByLabelText('Formula'), ' - alert(1)')
    expect(screen.getByText(/"alert" is not something a formula knows/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save formula' })).toBeDisabled()

    // (The test tool treats "[" as a key command, so the text is set directly.)
    fireEvent.change(screen.getByLabelText('Formula'), { target: { value: '[Sleep duration] - [Screen time]' } })
    await userEvent.selectOptions(screen.getByLabelText('Show the result as'), 'duration')
    // The unit field stays visible but explains why it is unavailable for durations.
    expect(screen.getByLabelText('Unit (optional)')).toBeDisabled()
    expect(screen.getByText(/Choose “A number” to add a unit/)).toBeInTheDocument()
    // Latest: 2 Nov, 6 h − 7 h = −1 h.
    expect(screen.getByText('Calculated on 2 days; latest 02/11/2026: −1 h 00 min.')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Save formula' }))
    expect(await screen.findByText(/^Formula added/)).toBeInTheDocument()
    const saved = await loadFormulas()
    expect(saved).toEqual([{ id: expect.stringMatching(/^f_/), name: 'Sleep minus screens', unit: null, display: 'duration', expression: '{sleep:duration} - {screenTime}' }])
  })

  it('lists, edits and deletes (with confirmation) formulas', async () => {
    const existing: FormulaDefinition = { id: 'f_abc12345', name: 'Screens doubled', unit: 'h', display: 'number', expression: '{screenTime} * 2' }
    await db.settings.put({ key: 'formulas', value: JSON.stringify([existing]), updatedAt: '2026-11-10T00:00:00.000Z', deletedAt: null, syncStatus: 'pending', revision: 1, syncedRevision: null })
    setup([existing])

    expect(screen.getByText('[Screen time] * 2')).toBeInTheDocument()
    expect(screen.getByText(/Number \(h\) · 2 days with a value/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Edit Screens doubled' }))
    expect(screen.getByLabelText('Formula')).toHaveValue('[Screen time] * 2')
    await userEvent.clear(screen.getByLabelText('Name'))
    await userEvent.type(screen.getByLabelText('Name'), 'Screens tripled')
    fireEvent.change(screen.getByLabelText('Formula'), { target: { value: '[Screen time] * 3' } })
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByText('Formula updated.')).toBeInTheDocument()
    expect((await loadFormulas())[0]).toMatchObject({ id: 'f_abc12345', name: 'Screens tripled', expression: '{screenTime} * 3' })

    const item = screen.getByText('Screens tripled').closest('li') as HTMLElement
    await userEvent.click(within(item).getByRole('button', { name: 'Delete Screens tripled' }))
    await userEvent.click(within(item).getByRole('button', { name: 'Confirm delete' }))
    expect(await screen.findByText('Formula deleted.')).toBeInTheDocument()
    expect(await loadFormulas()).toEqual([])
  })
})
