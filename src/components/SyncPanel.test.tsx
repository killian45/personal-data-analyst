import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { db, PersonalDataDatabase } from '../database/db'
import { createHabit, updateHabit } from '../database/habits'
import { startStopwatch } from '../database/stopwatches'
import { nextSyncFields } from '../database/sync'
import { createKeys, MIN_PBKDF2_ITERATIONS } from '../sync/crypto'
import { linkDevice } from '../sync/device'
import { conflictId, runSyncRound } from '../sync/engine'
import { createSyncController } from '../sync/syncController'
import { createMemoryBackend, TEST_CODE, type MemoryBackend } from '../sync/testing/memoryBackend'
import { SyncPanel } from './SyncPanel'

const USER = { id: 'user-1', email: 'me@example.com' }
const PASSPHRASE = 'correct horse battery staple'
const FAST = MIN_PBKDF2_ITERATIONS

function renderPanel(backend: MemoryBackend | null, onDataChanged = vi.fn()) {
  const controller = backend ? createSyncController({ db, backend }) : null
  controller?.onDataChanged(onDataChanged)
  render(
    <SyncPanel
      backend={backend}
      controller={controller}
      displayTimezone="Europe/Paris"
      onDataChanged={onDataChanged}
      keyIterations={FAST}
    />,
  )
  return { controller, onDataChanged }
}

beforeEach(async () => {
  await db.delete()
  await db.open()
})

afterEach(async () => {
  cleanup()
  db.close()
  await db.delete()
})

describe('SyncPanel', () => {
  it('explains that sync is off when no server is configured and offers to connect one', async () => {
    renderPanel(null)
    expect(screen.getByText(/Sync is off: no server is connected/)).toBeInTheDocument()
    expect(await screen.findByLabelText('Server address (Project URL)')).toBeInTheDocument()
  })

  it('signs in with an emailed code and refuses a wrong code', async () => {
    const backend = createMemoryBackend()
    renderPanel(backend)

    await userEvent.type(await screen.findByLabelText('Email address'), 'me@example.com')
    await userEvent.click(screen.getByRole('button', { name: 'Send sign-in code' }))
    expect(backend.sentCodesTo).toEqual(['me@example.com'])

    await userEvent.type(screen.getByLabelText('Sign-in code'), '000000')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('That code is wrong or has expired')

    await userEvent.clear(screen.getByLabelText('Sign-in code'))
    await userEvent.type(screen.getByLabelText('Sign-in code'), TEST_CODE)
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByText('Set up sync (first device)')).toBeInTheDocument()
    expect(screen.getByText('Signed in as me@example.com.')).toBeInTheDocument()
  })

  it('first device: checks the passphrase, shows the recovery key, uploads only after confirmation', async () => {
    await createHabit({ name: 'Water', type: 'number', unit: 'ml' })
    const backend = createMemoryBackend({ signedInAs: USER })
    renderPanel(backend)

    const passphrase = await screen.findByLabelText(/^Passphrase \(at least 12 characters\)/)
    await userEvent.type(passphrase, 'too short')
    await userEvent.type(screen.getByLabelText('Repeat the passphrase'), 'too short')
    await userEvent.click(screen.getByRole('button', { name: 'Create encryption key' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('at least 12 characters (it has 9)')

    await userEvent.clear(passphrase)
    await userEvent.type(passphrase, PASSPHRASE)
    await userEvent.click(screen.getByRole('button', { name: 'Create encryption key' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The two passphrases are different.')

    await userEvent.clear(screen.getByLabelText('Repeat the passphrase'))
    await userEvent.type(screen.getByLabelText('Repeat the passphrase'), PASSPHRASE)
    await userEvent.click(screen.getByRole('button', { name: 'Create encryption key' }))

    const recoveryKey = await screen.findByTestId('recovery-key')
    expect(recoveryKey.textContent).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){6}$/)
    expect(backend.server.envelope).toBeNull()

    const start = screen.getByRole('button', { name: 'Start syncing' })
    expect(start).toBeDisabled()
    await userEvent.click(screen.getByLabelText('I have saved my recovery key somewhere safe.'))
    await userEvent.click(start)

    expect(await screen.findByRole('status')).toHaveTextContent('Sync finished. Received 0 changes, sent 1 change.')
    expect(backend.server.envelope).not.toBeNull()
    expect(backend.server.rows()).toHaveLength(1)
    expect(screen.getByText('No changes waiting to be sent.')).toBeInTheDocument()
  })

  it('another device: refuses a wrong passphrase, then unlocks and receives the data', async () => {
    const keys = await createKeys(PASSPHRASE, { iterations: FAST })
    const backend = createMemoryBackend({ signedInAs: USER, envelope: keys.envelope })
    // Device A already synced a habit.
    const deviceA = new PersonalDataDatabase('device-A')
    await deviceA.open()
    await linkDevice(deviceA, { userId: USER.id, dataKey: keys.dataKey, keyVersion: 1 })
    await deviceA.habits.put({
      id: 'h-1', name: 'Reading', type: 'checkbox', unit: null, labelOptions: null, color: '#2563eb',
      archived: false, sortOrder: 0, syncStatus: 'pending', revision: 1, syncedRevision: null,
      createdAt: '2026-11-10T08:00:00.000Z', updatedAt: '2026-11-10T08:00:00.000Z', deletedAt: null,
    })
    await runSyncRound({ db: deviceA, server: backend.server })

    const { onDataChanged } = renderPanel(backend)

    await userEvent.type(await screen.findByLabelText('Passphrase'), 'not the passphrase')
    await userEvent.click(screen.getByRole('button', { name: 'Unlock' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong passphrase.')

    await userEvent.clear(screen.getByLabelText('Passphrase'))
    await userEvent.type(screen.getByLabelText('Passphrase'), PASSPHRASE)
    await userEvent.click(screen.getByRole('button', { name: 'Unlock' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Received 1 change, sent 0 changes.')
    expect((await db.habits.get('h-1'))?.name).toBe('Reading')
    expect(onDataChanged).toHaveBeenCalled()

    deviceA.close()
    await deviceA.delete()
  })

  it('unlocks with the recovery key and explains a typo', async () => {
    const keys = await createKeys(PASSPHRASE, { iterations: FAST })
    const backend = createMemoryBackend({ signedInAs: USER, envelope: keys.envelope })
    renderPanel(backend)

    await userEvent.click(await screen.findByLabelText('Use my recovery key'))
    const typo = (keys.recoveryKey[0] === '0' ? '1' : '0') + keys.recoveryKey.slice(1)
    await userEvent.type(screen.getByRole('textbox', { name: 'Recovery key' }), typo)
    await userEvent.click(screen.getByRole('button', { name: 'Unlock' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The recovery key has a typo.')

    await userEvent.clear(screen.getByRole('textbox', { name: 'Recovery key' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Recovery key' }), keys.recoveryKey.toLowerCase())
    await userEvent.click(screen.getByRole('button', { name: 'Unlock' }))
    expect(await screen.findByRole('button', { name: 'Sync now' })).toBeInTheDocument()
  })

  it('forgotten passphrase: unlock with the recovery key, then set a new passphrase', async () => {
    const keys = await createKeys(PASSPHRASE, { iterations: FAST })
    const backend = createMemoryBackend({ signedInAs: USER, envelope: keys.envelope })
    renderPanel(backend)

    await userEvent.click(await screen.findByLabelText('Use my recovery key'))
    await userEvent.type(screen.getByRole('textbox', { name: 'Recovery key' }), keys.recoveryKey)
    await userEvent.click(screen.getByRole('button', { name: 'Unlock' }))

    expect(await screen.findByText(/Unlocked with your recovery key/)).toBeInTheDocument()
    // The "Change passphrase" section is opened for the user.
    // The synced view (with "Change passphrase") appears once the device is linked.
    const summary = await screen.findByText('Change passphrase', { selector: 'summary' })
    const details = summary.closest('details') as HTMLDetailsElement
    expect(details.open).toBe(true)

    await userEvent.click(within(details).getByLabelText('Use my recovery key'))
    await userEvent.type(within(details).getByRole('textbox', { name: 'Recovery key' }), keys.recoveryKey)
    await userEvent.type(within(details).getByLabelText(/^New passphrase/), 'my new memorable sentence')
    await userEvent.type(within(details).getByLabelText('Repeat the new passphrase'), 'my new memorable sentence')
    const before = backend.server.envelope
    await userEvent.click(within(details).getByRole('button', { name: 'Change passphrase' }))

    expect(await within(details).findByText(/Passphrase changed/)).toBeInTheDocument()
    expect(backend.server.envelope?.salt).not.toEqual(before?.salt)
    expect(backend.server.envelope?.wrappedKeyRec).toEqual(before?.wrappedKeyRec)
  })

  it('lost both secrets: starting over deletes the cloud copy (after typing START OVER) and offers a fresh setup', async () => {
    const keys = await createKeys(PASSPHRASE, { iterations: FAST })
    const backend = createMemoryBackend({ signedInAs: USER, envelope: keys.envelope })
    await createHabit({ name: 'Water', type: 'number', unit: 'ml' })
    renderPanel(backend)

    await userEvent.click(await screen.findByText('Lost both your passphrase and your recovery key?'))
    const button = screen.getByRole('button', { name: 'Delete the cloud copy and start over' })
    expect(button).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Type START OVER to confirm'), 'START OVER')
    await userEvent.click(button)

    expect(await screen.findByText(/Started over: the cloud copy was deleted/)).toBeInTheDocument()
    expect(await screen.findByText('Set up sync (first device)')).toBeInTheDocument()
    expect(backend.server.envelope).toBeNull()
    expect(await db.habits.count()).toBe(1)
  })

  describe('linked device', () => {
    async function linkedBackend() {
      const keys = await createKeys(PASSPHRASE, { iterations: FAST })
      const backend = createMemoryBackend({ signedInAs: USER, envelope: keys.envelope })
      await linkDevice(db, { userId: USER.id, dataKey: keys.dataKey, keyVersion: 1 })
      return { backend, keys }
    }

    it('shows pending changes and sends them with "Sync now"', async () => {
      const { backend } = await linkedBackend()
      await createHabit({ name: 'Water', type: 'number', unit: 'ml' })
      renderPanel(backend)

      expect(await screen.findByText('1 change waiting to be sent.')).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Sync now' }))
      expect(await screen.findByRole('status')).toHaveTextContent('sent 1 change')
      expect(await screen.findByText('No changes waiting to be sent.')).toBeInTheDocument()
    })

    it('shows a conflict side by side and applies the chosen version', async () => {
      const { backend } = await linkedBackend()
      const habit = await createHabit({ name: 'Water', type: 'number', unit: 'ml' })
      await runSyncRound({ db, server: backend.server })
      // Changed here, and (simulated) changed differently on another device.
      await updateHabit(habit.id, { name: 'Water here', type: 'number', unit: 'ml', color: habit.color })
      const local = await db.habits.get(habit.id)
      if (!local) throw new Error('missing habit')
      await db.habits.put({ ...local, syncStatus: 'conflict' })
      await db.syncConflicts.put({
        id: conflictId('habits', habit.id),
        kind: 'conflict',
        collection: 'habits',
        recordId: habit.id,
        remoteRecord: { ...local, ...nextSyncFields(local), name: 'Water elsewhere', syncStatus: 'synced' },
        remoteRevision: 2,
        detectedAt: '2026-11-10T08:00:00.000Z',
      })
      const { onDataChanged } = renderPanel(backend)

      const item = (await screen.findByText('Habit “Water here”')).closest('li') as HTMLElement
      const row = within(item).getByRole('row', { name: /Name/ })
      expect(row).toHaveTextContent('Water here')
      expect(row).toHaveTextContent('Water elsewhere')

      await userEvent.click(within(item).getByRole('button', { name: 'Keep the other version' }))

      await waitFor(async () => expect((await db.habits.get(habit.id))?.name).toBe('Water elsewhere'))
      expect(await db.syncConflicts.count()).toBe(0)
      expect(onDataChanged).toHaveBeenCalled()
      // Choosing starts a sync in the background; wait for it to finish.
      expect(await screen.findByRole('status')).toHaveTextContent('Sync finished')
    })

    it('changes the passphrase with the current one and refuses a wrong current passphrase', async () => {
      const { backend } = await linkedBackend()
      renderPanel(backend)

      await userEvent.click(await screen.findByText('Change passphrase', { selector: 'summary' }))
      await userEvent.type(screen.getByLabelText('Current passphrase'), 'not the passphrase')
      await userEvent.type(screen.getByLabelText(/^New passphrase/), 'my new memorable sentence')
      await userEvent.type(screen.getByLabelText('Repeat the new passphrase'), 'my new memorable sentence')
      await userEvent.click(screen.getByRole('button', { name: 'Change passphrase' }))
      expect(await screen.findByRole('alert')).toHaveTextContent('Wrong passphrase.')

      await userEvent.clear(screen.getByLabelText('Current passphrase'))
      await userEvent.type(screen.getByLabelText('Current passphrase'), PASSPHRASE)
      await userEvent.click(screen.getByRole('button', { name: 'Change passphrase' }))
      expect(await screen.findByText(/Passphrase changed/)).toBeInTheDocument()
    })

    it('signs out: this device stops syncing and keeps its data', async () => {
      const { backend } = await linkedBackend()
      await createHabit({ name: 'Water', type: 'number', unit: 'ml' })
      renderPanel(backend)

      await userEvent.click(await screen.findByText('Sign out on this device', { selector: 'summary' }))
      await userEvent.click(screen.getByRole('button', { name: 'Sign out and keep the data here' }))

      expect(await screen.findByLabelText('Email address')).toBeInTheDocument()
      expect(await db.syncState.count()).toBe(0)
      expect(await db.habits.count()).toBe(1)
    })

    it('signs out and removes the data after a final sync, only after typing REMOVE', async () => {
      const { backend } = await linkedBackend()
      await createHabit({ name: 'Water', type: 'number', unit: 'ml' }) // not sent yet: the final sync sends it
      const { onDataChanged } = renderPanel(backend)

      await userEvent.click(await screen.findByText('Sign out on this device', { selector: 'summary' }))
      const button = screen.getByRole('button', { name: 'Sign out and remove the data' })
      expect(button).toBeDisabled()
      await userEvent.type(screen.getByLabelText('Type REMOVE to confirm'), 'REMOVE')
      await userEvent.click(button)

      expect(await screen.findByText(/All data was removed from this browser/)).toBeInTheDocument()
      expect(await screen.findByLabelText('Email address')).toBeInTheDocument()
      expect(await db.habits.count()).toBe(0)
      expect(await db.syncState.count()).toBe(0)
      expect(backend.server.rows()).toHaveLength(1)
      expect(await backend.auth.getUser()).toBeNull()
      expect(onDataChanged).toHaveBeenCalled()
    })

    it('refuses to remove the data while a stopwatch is running, and stays signed in', async () => {
      const { backend } = await linkedBackend()
      const reading = await createHabit({ name: 'Reading', type: 'stopwatch' })
      await startStopwatch(reading.id)
      renderPanel(backend)

      await userEvent.click(await screen.findByText('Sign out on this device', { selector: 'summary' }))
      await userEvent.type(screen.getByLabelText('Type REMOVE to confirm'), 'REMOVE')
      await userEvent.click(screen.getByRole('button', { name: 'Sign out and remove the data' }))

      const alert = await screen.findByText(/Nothing was removed and you are still signed in/)
      expect(alert.closest('[role="alert"]')).toHaveTextContent('1 stopwatch is running')
      expect(await db.habits.count()).toBe(1)
      expect(await db.activeTimers.count()).toBe(1)
      expect(await backend.auth.getUser()).not.toBeNull()
    })

    it('deletes the cloud data only after typing DELETE, keeping local data', async () => {
      const { backend } = await linkedBackend()
      await createHabit({ name: 'Water', type: 'number', unit: 'ml' })
      await runSyncRound({ db, server: backend.server })
      renderPanel(backend)

      await userEvent.click(await screen.findByText('Delete my cloud data', { selector: 'summary' }))
      const button = screen.getByRole('button', { name: 'Delete my cloud data' })
      expect(button).toBeDisabled()
      await userEvent.type(screen.getByLabelText('Type DELETE to confirm'), 'DELETE')
      await userEvent.click(button)

      expect(await screen.findByText(/Cloud data deleted \(1 encrypted records\)/)).toBeInTheDocument()
      expect(backend.server.envelope).toBeNull()
      expect(backend.server.rows()).toEqual([])
      expect(await db.syncState.count()).toBe(0)
      expect(await db.habits.count()).toBe(1)
    })
  })
})
