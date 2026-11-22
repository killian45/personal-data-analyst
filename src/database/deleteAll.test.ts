import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { saveDisplayTimezone } from '../settings/displayTimezone'
import { MIN_PBKDF2_ITERATIONS } from '../sync/crypto'
import { completeFirstDeviceSetup, prepareFirstDeviceKeys } from '../sync/device'
import { runSyncRound } from '../sync/engine'
import { createMemoryServer, type MemoryServer } from '../sync/testing/memoryServer'
import { db } from './db'
import { backupRequired, deleteAllLocalData, missingSteps, summarizeLocalData } from './deleteAll'
import type { DeleteChoices, LocalDataSummary } from './deleteAll'
import { createInteraction } from './contactInteractions'
import { createContact } from './contacts'
import { createHabit } from './habits'
import { startStopwatch } from './stopwatches'

const USER = 'user-1'
const ALL_DONE: DeleteChoices = { backupDownloaded: true, acceptLosingUnsent: true, acceptLosingStopwatches: true, confirmation: 'DELETE' }
let server: MemoryServer

beforeEach(async () => {
  await db.delete()
  await db.open()
  server = createMemoryServer(USER, null)
})

afterEach(async () => {
  db.close()
  await db.delete()
})

async function linkAndSync() {
  const keys = await prepareFirstDeviceKeys('correct horse battery staple', { iterations: MIN_PBKDF2_ITERATIONS })
  await completeFirstDeviceSetup(db, server, USER, keys)
  await runSyncRound({ db, server })
}

async function totalRecords() {
  let total = 0
  for (const table of db.tables) total += await table.count()
  return total
}

function summary(overrides: Partial<LocalDataSummary>): LocalDataSummary {
  return { counts: [], total: 5, linked: true, pending: 0, conflicts: 0, runningStopwatches: 0, fingerprint: 'x', ...overrides }
}

describe('summarizeLocalData', () => {
  it('counts the records and reports an unlinked device', async () => {
    const habit = await createHabit({ name: 'Reading', type: 'stopwatch' })
    await saveDisplayTimezone('Europe/Paris')
    await startStopwatch(habit.id)

    const result = await summarizeLocalData(db)
    expect(result.counts.find((item) => item.label === 'habits')?.count).toBe(1)
    expect(result.runningStopwatches).toBe(1)
    expect(result.total).toBe(3) // habit + setting + stopwatch
    expect(result.linked).toBe(false)
    expect(result.pending).toBe(2) // habit + setting never sent
    expect(backupRequired(result)).toBe(true)
  })

  it('does not require a backup on a linked device with everything sent', async () => {
    await createHabit({ name: 'Water', type: 'number', unit: 'ml' })
    await linkAndSync()
    const result = await summarizeLocalData(db)
    expect(result).toMatchObject({ linked: true, pending: 0, conflicts: 0 })
    expect(backupRequired(result)).toBe(false)
  })

  it('counts contacts and interactions; unsent ones require a backup, synced ones do not', async () => {
    await createHabit({ name: 'Water', type: 'number', unit: 'ml' })
    await linkAndSync()
    const contact = await createContact({ name: 'Bob' })
    await createInteraction({ contactId: contact.id, text: 'Lunch' })

    const before = await summarizeLocalData(db)
    expect(before.counts.find((item) => item.label === 'contacts')?.count).toBe(1)
    expect(before.counts.find((item) => item.label === 'contact interactions')?.count).toBe(1)
    expect(before.runningStopwatches).toBe(0)
    expect(before).toMatchObject({ linked: true, pending: 2 })
    expect(backupRequired(before)).toBe(true)

    expect(await runSyncRound({ db, server })).toMatchObject({ status: 'ok', pushed: 2 })
    const after = await summarizeLocalData(db)
    expect(after).toMatchObject({ linked: true, pending: 0 })
    expect(backupRequired(after)).toBe(false)
  })
})

describe('missingSteps (pure)', () => {
  const none: DeleteChoices = { backupDownloaded: false, acceptLosingUnsent: false, acceptLosingStopwatches: false, confirmation: '' }

  it('needs only "DELETE" on a linked device with everything sent', () => {
    expect(missingSteps(summary({}), none)).toEqual(['Type DELETE to confirm.'])
    expect(missingSteps(summary({}), { ...none, confirmation: 'delete' })).toEqual(['Type DELETE to confirm.'])
    expect(missingSteps(summary({}), { ...none, confirmation: ' DELETE ' })).toEqual([])
  })

  it('needs a backup when the device is not linked, or has unsent changes or conflicts', () => {
    expect(missingSteps(summary({ linked: false }), { ...none, confirmation: 'DELETE' })).toEqual(['Download a backup first.'])
    expect(missingSteps(summary({ conflicts: 1 }), { ...none, confirmation: 'DELETE' })).toEqual(['Download a backup first.'])
    expect(missingSteps(summary({ pending: 2 }), { ...none, confirmation: 'DELETE' })).toEqual([
      'Download a backup first.',
      'Sync first, or confirm that the 2 unsent changes will be lost.',
    ])
    expect(missingSteps(summary({ pending: 2 }), { ...none, backupDownloaded: true, acceptLosingUnsent: true, confirmation: 'DELETE' })).toEqual([])
  })

  it('needs running stopwatches acknowledged', () => {
    expect(missingSteps(summary({ runningStopwatches: 1 }), { ...none, confirmation: 'DELETE' })).toEqual([
      'Confirm that the running stopwatches will be lost.',
    ])
  })

  it('refuses when there is nothing to delete', () => {
    expect(missingSteps(summary({ total: 0, linked: false }), ALL_DONE)).toEqual(['There is nothing to delete.'])
  })
})

describe('deleteAllLocalData', () => {
  it('deletes nothing while a safeguard is missing', async () => {
    await createHabit({ name: 'Water', type: 'number', unit: 'ml' })
    const reviewed = await summarizeLocalData(db)

    await expect(deleteAllLocalData(db, reviewed, { ...ALL_DONE, backupDownloaded: false })).rejects.toThrow('Download a backup first.')
    await expect(deleteAllLocalData(db, reviewed, { ...ALL_DONE, confirmation: 'DELET' })).rejects.toThrow('Type DELETE')
    expect(await db.habits.count()).toBe(1)
  })

  it('deletes nothing when the data changed after it was reviewed', async () => {
    await createHabit({ name: 'Water', type: 'number', unit: 'ml' })
    const reviewed = await summarizeLocalData(db)
    await createHabit({ name: 'Gym', type: 'checkbox' })

    await expect(deleteAllLocalData(db, reviewed, ALL_DONE)).rejects.toThrow('changed since you reviewed it')
    expect(await db.habits.count()).toBe(2)
  })

  it('empties every table of an unlinked device', async () => {
    const habit = await createHabit({ name: 'Reading', type: 'stopwatch' })
    await saveDisplayTimezone('Europe/Paris')
    await startStopwatch(habit.id)
    expect(await totalRecords()).toBeGreaterThan(0)

    await deleteAllLocalData(db, await summarizeLocalData(db), ALL_DONE)

    for (const table of db.tables) expect(await table.count(), table.name).toBe(0)
  })

  it('removes the sync link too, and never touches the server copy', async () => {
    await createHabit({ name: 'Water', type: 'number', unit: 'ml' })
    await linkAndSync()
    await createHabit({ name: 'Gym', type: 'checkbox' }) // unsent, accepted as lost
    const rowsBefore = JSON.stringify(server.rows())
    const envelopeBefore = server.envelope

    await deleteAllLocalData(db, await summarizeLocalData(db), ALL_DONE)

    for (const table of db.tables) expect(await table.count(), table.name).toBe(0)
    expect(JSON.stringify(server.rows())).toBe(rowsBefore)
    expect(server.envelope).toBe(envelopeBefore)
    // Unlinked now: a sync round does nothing (it cannot send deletions).
    expect(await runSyncRound({ db, server })).toMatchObject({ status: 'not-set-up' })
    expect(JSON.stringify(server.rows())).toBe(rowsBefore)
  })

  it('blocks sync rounds while deleting', async () => {
    await createHabit({ name: 'Water', type: 'number', unit: 'ml' })
    await linkAndSync()
    const deleting = deleteAllLocalData(db, await summarizeLocalData(db), ALL_DONE)

    expect(await runSyncRound({ db, server })).toEqual({ status: 'busy' })
    await deleting
    expect(await totalRecords()).toBe(0)
  })
})
