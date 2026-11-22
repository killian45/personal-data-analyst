import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { db } from './db'
import {
  createContact,
  deleteContact,
  getContact,
  getContacts,
  getDeletedContacts,
  restoreContact,
  updateContact,
} from './contacts'
import { createInteraction, getInteractionsByContact } from './contactInteractions'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

afterEach(async () => {
  vi.useRealTimers()
  db.close()
  await db.delete()
})

describe('createContact', () => {
  it('stores a new contact, pending sync, with every field normalised', async () => {
    const contact = await createContact({
      name: '  Amélie ',
      description: ' Met at university ',
      education: '',
      address: '12 rue X\n75011 Paris',
      birthday: '--05-17',
      interests: 'Jazz',
      dislikes: '   ',
    })

    expect(contact).toMatchObject({
      name: 'Amélie',
      description: 'Met at university',
      education: null,
      address: '12 rue X\n75011 Paris',
      birthday: '--05-17',
      interests: 'Jazz',
      dislikes: null,
      externalPhoneId: null,
      syncStatus: 'pending',
      revision: 1,
      syncedRevision: null,
      deletedAt: null,
    })
    expect(contact.createdAt).toBe(contact.updatedAt)
    expect(await db.contacts.get(contact.id)).toEqual(contact)
  })

  it('only a name is required', async () => {
    const contact = await createContact({ name: 'Bob' })
    expect(contact).toMatchObject({ description: null, education: null, address: null, birthday: null, interests: null, dislikes: null })
  })

  it('refuses invalid input and stores nothing', async () => {
    await expect(createContact({ name: '  ' })).rejects.toThrow('Name is required.')
    await expect(createContact({ name: 'Bob', birthday: '2023-02-29' })).rejects.toThrow('not a real calendar date')
    await expect(createContact({ name: 'Bob', interests: 'a'.repeat(5001) })).rejects.toThrow('Interests & likes cannot exceed')
    expect(await db.contacts.count()).toBe(0)
  })

  it('keeps the phone identifier given by an import', async () => {
    const contact = await createContact({ name: 'Bob', externalPhoneId: '42' })
    expect(contact.externalPhoneId).toBe('42')
  })
})

describe('updateContact', () => {
  it('changes only the given fields and increases the revision', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-12T10:00:00.000Z'))
    const contact = await createContact({ name: 'Bob', interests: 'Chess', address: 'Lyon' })

    vi.setSystemTime(new Date('2026-11-12T11:00:00.000Z'))
    const updated = await updateContact(contact.id, { interests: ' Chess, hiking ', education: 'MSc Physics' })

    expect(updated).toEqual({
      ...contact,
      interests: 'Chess, hiking',
      education: 'MSc Physics',
      revision: 2,
      syncStatus: 'pending',
      updatedAt: '2026-11-12T11:00:00.000Z',
    })
    expect(await db.contacts.get(contact.id)).toEqual(updated)
  })

  it('writes nothing when no value really changes', async () => {
    const contact = await createContact({ name: 'Bob', interests: 'Chess' })
    const same = await updateContact(contact.id, { name: ' Bob ', interests: 'Chess  ', dislikes: '' })
    expect(same).toEqual(contact)
    expect(await db.contacts.get(contact.id)).toEqual(contact)
  })

  it('clearing a field stores null', async () => {
    const contact = await createContact({ name: 'Bob', birthday: '1990-05-17' })
    expect((await updateContact(contact.id, { birthday: '' })).birthday).toBeNull()
  })

  it('a contact in conflict stays in conflict when edited', async () => {
    const contact = await createContact({ name: 'Bob' })
    await db.contacts.put({ ...contact, syncStatus: 'conflict', syncedRevision: 1 })
    const updated = await updateContact(contact.id, { name: 'Robert' })
    expect(updated).toMatchObject({ syncStatus: 'conflict', revision: 2, syncedRevision: 1 })
  })

  it('refuses invalid values without changing anything', async () => {
    const contact = await createContact({ name: 'Bob' })
    await expect(updateContact(contact.id, { name: '' })).rejects.toThrow('Name is required.')
    await expect(updateContact(contact.id, { birthday: '31/12/1990' })).rejects.toThrow('Birthday must be a date')
    expect(await db.contacts.get(contact.id)).toEqual(contact)
  })

  it('cannot change a deleted or missing contact', async () => {
    const contact = await createContact({ name: 'Bob' })
    await deleteContact(contact.id)
    await expect(updateContact(contact.id, { name: 'Robert' })).rejects.toThrow('Contact not found.')
    await expect(updateContact('missing', { name: 'Robert' })).rejects.toThrow('Contact not found.')
  })
})

describe('deleting and restoring', () => {
  it('soft-deletes (kept, hidden), then restores with its interactions', async () => {
    const contact = await createContact({ name: 'Bob' })
    const interaction = await createInteraction({ contactId: contact.id, text: 'Lunch', occurredStart: '2026-11-10T12:00:00.000Z', timezone: 'Europe/Paris' })

    await deleteContact(contact.id)
    const deleted = await db.contacts.get(contact.id)
    expect(deleted).toMatchObject({ revision: 2, syncStatus: 'pending', deletedAt: expect.any(String) })
    expect(await getContact(contact.id)).toBeUndefined()
    expect(await getContacts()).toEqual([])
    expect(await getDeletedContacts()).toEqual([deleted])
    // The interaction itself is untouched.
    expect(await db.contactInteractions.get(interaction.id)).toEqual(interaction)

    const restored = await restoreContact(contact.id)
    expect(restored).toMatchObject({ revision: 3, deletedAt: null })
    expect(await getInteractionsByContact(contact.id)).toEqual([interaction])
  })

  it('refuses to delete twice or restore a contact that is not deleted', async () => {
    const contact = await createContact({ name: 'Bob' })
    await expect(restoreContact(contact.id)).rejects.toThrow('This contact is not deleted.')
    await deleteContact(contact.id)
    await expect(deleteContact(contact.id)).rejects.toThrow('Contact not found.')
  })
})

describe('getContacts', () => {
  it('lists contacts by name, ignoring case and accents', async () => {
    for (const name of ['zoé', 'Émile', 'bob', 'Alice']) await createContact({ name })
    expect((await getContacts()).map((contact) => contact.name)).toEqual(['Alice', 'bob', 'Émile', 'zoé'])
  })
})
