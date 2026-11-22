import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createBackup, serializeBackup } from '../backup/backup'
import { db } from '../database/db'
import { createEntry } from '../database/entries'
import { createHabit } from '../database/habits'

import { RestoreBackupPanel } from './RestoreBackupPanel'

const START = '2026-11-09T08:00:00.000Z'

async function clearAll() {
  await db.transaction('rw', db.tables, async () => {
    for (const table of db.tables) {
      await table.clear()
    }
  })
}

function backupFile(text: string, name = 'pda-backup.json') {
  return new File([text], name, { type: 'application/json' })
}

describe('RestoreBackupPanel', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(async () => {
    cleanup()
    db.close()
    await db.delete()
  })

  it('previews a backup, then restores it after confirmation', async () => {
    const water = await createHabit({ name: 'Water', type: 'number' })
    await createEntry({ habitId: water.id, value: 1, occurredStart: START })
    await createEntry({ habitId: water.id, value: 2, occurredStart: START })
    const text = serializeBackup(await createBackup())
    await clearAll()
    const onRestored = vi.fn()

    render(<RestoreBackupPanel onRestored={onRestored} />)

    await userEvent.upload(screen.getByLabelText('Backup file (.json)'), backupFile(text))

    const entriesRow = (await screen.findByRole('rowheader', { name: 'Entries' })).closest('tr') as HTMLElement
    expect(within(entriesRow).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['2', '0', '0', '0'])

    // Nothing has been written yet.
    expect(await db.entries.count()).toBe(0)

    await userEvent.click(screen.getByRole('button', { name: 'Restore 3 records' }))

    expect(await screen.findByText('Restored 3 records.')).toBeInTheDocument()
    expect(await db.entries.count()).toBe(2)
    expect(await db.habits.count()).toBe(1)
    expect(onRestored).toHaveBeenCalledOnce()
  })

  it('says there is nothing to restore when everything is already here', async () => {
    await createHabit({ name: 'Water', type: 'number' })
    const text = serializeBackup(await createBackup())

    render(<RestoreBackupPanel />)

    await userEvent.upload(screen.getByLabelText('Backup file (.json)'), backupFile(text))

    expect(await screen.findByText(/Nothing to restore/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Restore \d/ })).not.toBeInTheDocument()
  })

  it('explains why a damaged file cannot be restored', async () => {
    render(<RestoreBackupPanel />)

    await userEvent.upload(screen.getByLabelText('Backup file (.json)'), backupFile('{ broken'))

    expect(await screen.findByRole('alert')).toHaveTextContent('This file is not valid JSON.')
  })

  it('lists invalid records with their reasons', async () => {
    const water = await createHabit({ name: 'Water', type: 'number' })
    await createEntry({ habitId: water.id, value: 1, occurredStart: START })
    const backup = await createBackup()
    await clearAll()

    // Make one entry invalid and recompute the fingerprint, as if the
    // backup came from a buggy version.
    ;(backup.tables.entries[0] as { value: unknown }).value = 'lots'
    const { computeTablesHash } = await import('../backup/backup')
    backup.integrity.tablesHash = await computeTablesHash(backup.tables)

    render(<RestoreBackupPanel />)

    await userEvent.upload(screen.getByLabelText('Backup file (.json)'), backupFile(serializeBackup(backup)))

    expect(await screen.findByText('Invalid records (will not be restored) (1)')).toBeInTheDocument()
    expect(screen.getByText(/Number habits require a finite numeric value|number habits require a finite numeric value/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Restore 1 record' })).toBeInTheDocument()
  })
})
