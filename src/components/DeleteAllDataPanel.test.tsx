import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { db } from '../database/db'
import { markJustDeleted } from '../database/deleteAll'
import { createHabit } from '../database/habits'
import { startStopwatch } from '../database/stopwatches'

import { DeleteAllDataPanel } from './DeleteAllDataPanel'

async function totalRecords() {
  let total = 0
  for (const table of db.tables) total += await table.count()
  return total
}

function renderPanel(overrides: Partial<Parameters<typeof DeleteAllDataPanel>[0]> = {}) {
  const props = { syncNow: null, afterDeletion: vi.fn(async () => {}), restart: vi.fn(), ...overrides }
  render(<DeleteAllDataPanel {...props} />)
  return props
}

describe('DeleteAllDataPanel', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
    sessionStorage.clear()
    // jsdom does not implement file downloads.
    URL.createObjectURL = vi.fn(() => 'blob:test')
    URL.revokeObjectURL = vi.fn()
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  })

  afterEach(async () => {
    cleanup()
    vi.restoreAllMocks()
    db.close()
    await db.delete()
  })

  it('on an unlinked device, requires a backup and DELETE before deleting everything', async () => {
    const user = userEvent.setup()
    await createHabit({ name: 'Water', type: 'number', unit: 'ml' })
    const props = renderPanel()

    await user.click(screen.getByRole('button', { name: 'Review what would be deleted…' }))
    expect(await screen.findByText('1 habits')).toBeInTheDocument()
    expect(screen.getByText(/not linked to sync: this data may exist nowhere else/)).toBeInTheDocument()

    const deleteButton = screen.getByRole('button', { name: 'Delete all data on this device' })
    await user.type(screen.getByLabelText('Type DELETE to confirm'), 'DELETE')
    expect(deleteButton).toBeDisabled() // backup still missing
    expect(screen.getByText('Download a backup first.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Download a backup' }))
    expect(await screen.findByRole('button', { name: /Backup downloaded/ })).toBeInTheDocument()
    expect(deleteButton).toBeEnabled()

    await user.click(deleteButton)
    await vi.waitFor(() => expect(props.restart).toHaveBeenCalledTimes(1))
    expect(props.afterDeletion).toHaveBeenCalledTimes(1)
    expect(await totalRecords()).toBe(0)
    expect(sessionStorage.getItem('pda.deletedAllData')).toBe('1')
  })

  it('needs running stopwatches acknowledged', async () => {
    const user = userEvent.setup()
    const habit = await createHabit({ name: 'Reading', type: 'stopwatch' })
    await startStopwatch(habit.id)
    renderPanel()

    await user.click(screen.getByRole('button', { name: 'Review what would be deleted…' }))
    await user.click(await screen.findByRole('button', { name: 'Download a backup' }))
    await user.type(screen.getByLabelText('Type DELETE to confirm'), 'DELETE')
    const deleteButton = screen.getByRole('button', { name: 'Delete all data on this device' })
    await vi.waitFor(() => expect(screen.getByRole('button', { name: /Backup downloaded/ })).toBeInTheDocument())
    expect(deleteButton).toBeDisabled()

    await user.click(screen.getByLabelText('I understand the 1 running stopwatch will be lost.'))
    expect(deleteButton).toBeEnabled()
  })

  it('deletes nothing and shows the new state when data changed after the review', async () => {
    const user = userEvent.setup()
    await createHabit({ name: 'Water', type: 'number', unit: 'ml' })
    const props = renderPanel()

    await user.click(screen.getByRole('button', { name: 'Review what would be deleted…' }))
    await user.click(await screen.findByRole('button', { name: 'Download a backup' }))
    await user.type(screen.getByLabelText('Type DELETE to confirm'), 'DELETE')
    await createHabit({ name: 'Gym', type: 'checkbox' }) // e.g. a sync arrived meanwhile
    await user.click(screen.getByRole('button', { name: 'Delete all data on this device' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('changed since you reviewed it')
    expect(await screen.findByText('2 habits')).toBeInTheDocument()
    expect(screen.getByLabelText('Type DELETE to confirm')).toHaveValue('') // must confirm again
    expect(await db.habits.count()).toBe(2)
    expect(props.afterDeletion).not.toHaveBeenCalled()
    expect(props.restart).not.toHaveBeenCalled()
  })

  it('reports a failed last step without restarting', async () => {
    const user = userEvent.setup()
    await createHabit({ name: 'Water', type: 'number', unit: 'ml' })
    const props = renderPanel({ afterDeletion: vi.fn(async () => { throw new Error('Could not delete the saved usage history.') }) })

    await user.click(screen.getByRole('button', { name: 'Review what would be deleted…' }))
    await user.click(await screen.findByRole('button', { name: 'Download a backup' }))
    await user.type(screen.getByLabelText('Type DELETE to confirm'), 'DELETE')
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Delete all data on this device' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: 'Delete all data on this device' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('one last step failed: Could not delete the saved usage history.')
    expect(props.restart).not.toHaveBeenCalled()
    expect(await totalRecords()).toBe(0)
  })

  it('shows the confirmation once after the restart', () => {
    markJustDeleted()
    renderPanel()
    expect(screen.getByRole('status')).toHaveTextContent('All data on this device was deleted.')
    expect(sessionStorage.getItem('pda.deletedAllData')).toBeNull()
  })
})
