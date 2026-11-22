import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createContact } from '../../database/contacts'
import { db } from '../../database/db'
import { createKeys, MIN_PBKDF2_ITERATIONS } from '../../sync/crypto'
import { linkDevice } from '../../sync/device'
import { createSyncController } from '../../sync/syncController'
import { createMemoryBackend } from '../../sync/testing/memoryBackend'
import type { PhoneContact } from '../../crm/phoneContactImport'

import PhoneContactImportPanel from './PhoneContactImportPanel'

// A simulated phone.
const phone = vi.hoisted(() => ({
  permission: 'prompt' as 'granted' | 'denied' | 'prompt',
  answer: 'granted' as 'granted' | 'denied',
  requests: 0,
  settingsOpened: 0,
  contacts: [] as PhoneContact[],
}))

vi.mock('../../crm/phoneContactsPlugin', () => ({
  checkContactsPermission: async () => phone.permission,
  requestContactsPermission: async () => {
    phone.requests += 1
    phone.permission = phone.answer
    return phone.permission
  },
  readPhoneContacts: async () => {
    if (phone.permission !== 'granted') throw new Error('not allowed')
    return phone.contacts
  },
}))

vi.mock('../../screenTime/usageStatsPlugin', () => ({
  openAppSettings: async () => {
    phone.settingsOpened += 1
  },
}))

const contact = (lookupKey: string, name: string, changes: Partial<PhoneContact> = {}): PhoneContact =>
  ({ lookupKey, name, addresses: [], birthdays: [], notes: [], ...changes })

describe('PhoneContactImportPanel', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
    Object.assign(phone, { permission: 'prompt', answer: 'granted', requests: 0, settingsOpened: 0, contacts: [] })
  })

  afterEach(async () => {
    cleanup()
    db.close()
    await db.delete()
  })

  it('asks for access, shows a preview with nothing chosen, and imports only the ticked contacts', async () => {
    phone.contacts = [
      contact('k1', 'Amélie', { birthdays: ['--05-17'], addresses: [{ formatted: 'Lyon', type: 1, label: null }] }),
      contact('k2', 'Bob the plumber'),
      contact('k3', 'Chloé', { birthdays: ['05/06/1990'] }),
    ]
    const onImported = vi.fn()
    const user = userEvent.setup()
    render(<PhoneContactImportPanel controller={null} syncConfigured={false} onImported={onImported} />)

    await user.click(screen.getByRole('button', { name: 'Read this phone\'s contacts' }))
    expect(phone.requests).toBe(1)
    expect(await screen.findByText('3 contacts on this phone; 3 can be imported.')).toBeInTheDocument()

    const list = screen.getByRole('list', { name: 'Contacts that can be imported' })
    expect(within(list).getAllByRole('checkbox').every((box) => !(box as HTMLInputElement).checked)).toBe(true)
    expect(screen.getByRole('button', { name: 'Import 0 contacts' })).toBeDisabled()
    expect(within(list).getByText('Birthday 17/05 · Lyon')).toBeInTheDocument()
    expect(within(list).getByText('birthday "05/06/1990" could not be read: not imported')).toBeInTheDocument()

    await user.click(within(list).getByLabelText(/Amélie/))
    await user.click(within(list).getByLabelText(/Chloé/))
    await user.click(screen.getByRole('button', { name: 'Import 2 contacts' }))

    expect(await screen.findByText('Imported 2 contacts. They are on the CRM page.')).toBeInTheDocument()
    expect(onImported).toHaveBeenCalledTimes(1)
    const stored = (await db.contacts.toArray()).sort((a, b) => a.name.localeCompare(b.name))
    expect(stored.map((c) => [c.name, c.externalPhoneId, c.birthday, c.address])).toEqual([
      ['Amélie', 'k1', '--05-17', 'Lyon'],
      ['Chloé', 'k3', null, null],
    ])

    // Reading again: the two are recognised, only Bob remains.
    await user.click(screen.getByRole('button', { name: 'Read this phone\'s contacts' }))
    expect(await screen.findByText('3 contacts on this phone; 1 can be imported.')).toBeInTheDocument()
    expect(screen.getByText('Already imported (2)')).toBeInTheDocument()
  })

  it('search, "Select all shown" and the same-name warning', async () => {
    await createContact({ name: 'Bob' })
    phone.permission = 'granted'
    phone.contacts = [contact('k1', 'Bob', { addresses: [{ formatted: 'Lyon', type: 1, label: null }] }), contact('k2', 'Alice'), contact('k3', 'Albert')]
    const user = userEvent.setup()
    render(<PhoneContactImportPanel controller={null} syncConfigured={false} />)
    await user.click(screen.getByRole('button', { name: 'Read this phone\'s contacts' }))
    expect(phone.requests).toBe(0) // already allowed

    const list = await screen.findByRole('list', { name: 'Contacts that can be imported' })
    expect(within(list).getByText('A contact with this name is already in the CRM.')).toBeInTheDocument()

    await user.type(screen.getByLabelText('Search'), 'al')
    expect(within(list).getAllByRole('checkbox')).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: 'Select all shown' }))
    expect(screen.getByRole('button', { name: 'Import 2 contacts' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Select none' }))
    expect(screen.getByRole('button', { name: 'Import 0 contacts' })).toBeDisabled()
  })

  it('explains a refusal and offers the app settings; nothing is read', async () => {
    phone.answer = 'denied'
    phone.contacts = [contact('k1', 'Bob')]
    const user = userEvent.setup()
    render(<PhoneContactImportPanel controller={null} syncConfigured={false} />)
    await user.click(screen.getByRole('button', { name: 'Read this phone\'s contacts' }))

    expect(await screen.findByText(/Access to contacts is not allowed/)).toBeInTheDocument()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Open app settings' }))
    expect(phone.settingsOpened).toBe(1)
    expect(await db.contacts.count()).toBe(0)
  })

  it('on a synced phone: asks to sync first; contacts from the cloud are recognised; new ones are sent', async () => {
    const keys = await createKeys('correct horse battery staple', { iterations: MIN_PBKDF2_ITERATIONS })
    const backend = createMemoryBackend({ signedInAs: { id: 'user-1', email: 'me@example.com' }, envelope: keys.envelope })

    // Another device (or this phone before a reinstall) imported Amélie and sent her to the cloud.
    const { PersonalDataDatabase } = await import('../../database/db')
    const { runSyncRound } = await import('../../sync/engine')
    const other = new PersonalDataDatabase('other-device')
    await other.open()
    await linkDevice(other, { userId: 'user-1', dataKey: keys.dataKey, keyVersion: 1 })
    await other.contacts.add({
      id: 'c-amelie', name: 'Amélie', description: null, education: null, address: null, birthday: null, interests: null, dislikes: null,
      externalPhoneId: 'k1', syncStatus: 'pending', revision: 1, syncedRevision: null,
      createdAt: '2026-11-12T10:00:00.000Z', updatedAt: '2026-11-12T10:00:00.000Z', deletedAt: null,
    })
    expect(await runSyncRound({ db: other, server: backend.server })).toMatchObject({ status: 'ok', pushed: 1 })
    other.close()
    await other.delete()

    await linkDevice(db, { userId: 'user-1', dataKey: keys.dataKey, keyVersion: 1 })
    const controller = createSyncController({ db, backend })
    await controller.refresh()
    phone.permission = 'granted'
    phone.contacts = [contact('k1', 'Amélie'), contact('k2', 'Bob')]
    const user = userEvent.setup()
    render(<PhoneContactImportPanel controller={controller} syncConfigured />)

    expect(await screen.findByText(/Sync first/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Read this phone\'s contacts' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Sync now' }))
    await user.click(await screen.findByRole('button', { name: 'Read this phone\'s contacts' }))

    // Amélie arrived with the sync, so only Bob can be imported.
    expect(await screen.findByText('2 contacts on this phone; 1 can be imported.')).toBeInTheDocument()
    expect(screen.getByText('Already imported (1)')).toBeInTheDocument()
    await user.click(screen.getByLabelText(/Bob/))
    await user.click(screen.getByRole('button', { name: 'Import 1 contact' }))
    expect(await screen.findByText('Imported 1 contact. They are on the CRM page.')).toBeInTheDocument()
    await vi.waitFor(() => expect(backend.server.rows().filter((row) => row.collection === 'contacts')).toHaveLength(2))
  })
})

