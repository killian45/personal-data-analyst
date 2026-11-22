import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { db } from './db'
import { createContact, deleteContact } from './contacts'
import {
  createInteraction,
  deleteInteraction,
  getInteractionsByContact,
  restoreInteraction,
  updateInteraction,
} from './contactInteractions'

let contactId: string

beforeEach(async () => {
  await db.delete()
  await db.open()
  contactId = (await createContact({ name: 'Bob' })).id
})

afterEach(async () => {
  vi.useRealTimers()
  db.close()
  await db.delete()
})

describe('createInteraction', () => {
  it('defaults to now, in this device timezone', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-12T13:45:00.000Z'))
    const interaction = await createInteraction({ contactId, text: ' Phone call ' })
    expect(interaction).toMatchObject({
      contactId,
      text: 'Phone call',
      occurredStart: '2026-11-12T13:45:00.000Z',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      syncStatus: 'pending',
      revision: 1,
      syncedRevision: null,
      deletedAt: null,
    })
    expect(await db.contactInteractions.get(interaction.id)).toEqual(interaction)
  })

  it('stores a chosen local time as the correct UTC instant', async () => {
    // 30/03/2026 01:30 in Paris (summer time since 29/03, UTC+2) is
    // 23:30 UTC the day before.
    const interaction = await createInteraction({ contactId, text: 'Late call', occurredStart: '2026-03-30T01:30:00+02:00', timezone: 'Europe/Paris' })
    expect(interaction.occurredStart).toBe('2026-03-29T23:30:00.000Z')
    expect(interaction.timezone).toBe('Europe/Paris')
  })

  it('refuses empty text, a bad time or timezone, and a deleted contact', async () => {
    await expect(createInteraction({ contactId, text: '  ' })).rejects.toThrow('Describe the interaction.')
    await expect(createInteraction({ contactId, text: 'x', occurredStart: '2026-11-12 10:00' })).rejects.toThrow('Timestamp must be')
    await expect(createInteraction({ contactId, text: 'x', timezone: 'Paris' })).rejects.toThrow()
    await deleteContact(contactId)
    await expect(createInteraction({ contactId, text: 'x' })).rejects.toThrow('Contact not found.')
    await expect(createInteraction({ contactId: 'missing', text: 'x' })).rejects.toThrow('Contact not found.')
    expect(await db.contactInteractions.count()).toBe(0)
  })
})

describe('updateInteraction', () => {
  it('changes the given fields and increases the revision', async () => {
    const interaction = await createInteraction({ contactId, text: 'Lunch', occurredStart: '2026-11-10T12:00:00.000Z', timezone: 'Europe/Paris' })
    const updated = await updateInteraction(interaction.id, { text: 'Lunch at Chez Marcel', occurredStart: '2026-11-10T08:00:00-05:00', timezone: 'America/New_York' })
    expect(updated).toMatchObject({
      text: 'Lunch at Chez Marcel',
      occurredStart: '2026-11-10T13:00:00.000Z',
      timezone: 'America/New_York',
      revision: 2,
      syncStatus: 'pending',
      createdAt: interaction.createdAt,
    })
  })

  it('writes nothing when nothing really changes', async () => {
    const interaction = await createInteraction({ contactId, text: 'Lunch', occurredStart: '2026-11-10T12:00:00.000Z', timezone: 'Europe/Paris' })
    // Same instant written with an offset, same text with spaces.
    const same = await updateInteraction(interaction.id, { text: ' Lunch ', occurredStart: '2026-11-10T13:00:00+01:00', timezone: 'Europe/Paris' })
    expect(same).toEqual(interaction)
    expect(await db.contactInteractions.get(interaction.id)).toEqual(interaction)
  })

  it('cannot change an interaction of a deleted contact', async () => {
    const interaction = await createInteraction({ contactId, text: 'Lunch' })
    await deleteContact(contactId)
    await expect(updateInteraction(interaction.id, { text: 'Dinner' })).rejects.toThrow('Contact not found.')
  })
})

describe('deleting, restoring and listing', () => {
  it('soft-deletes and restores an interaction', async () => {
    const interaction = await createInteraction({ contactId, text: 'Lunch' })
    await deleteInteraction(interaction.id)
    expect(await getInteractionsByContact(contactId)).toEqual([])
    expect(await db.contactInteractions.get(interaction.id)).toMatchObject({ revision: 2, deletedAt: expect.any(String) })
    await expect(deleteInteraction(interaction.id)).rejects.toThrow('Interaction not found.')

    const restored = await restoreInteraction(interaction.id)
    expect(restored).toMatchObject({ revision: 3, deletedAt: null })
    await expect(restoreInteraction(interaction.id)).rejects.toThrow('This interaction is not deleted.')
  })

  it('lists one contact\'s interactions, newest first', async () => {
    const other = await createContact({ name: 'Alice' })
    const older = await createInteraction({ contactId, text: 'Older', occurredStart: '2026-11-01T10:00:00.000Z', timezone: 'Europe/Paris' })
    const newer = await createInteraction({ contactId, text: 'Newer', occurredStart: '2026-11-11T10:00:00.000Z', timezone: 'Europe/Paris' })
    await createInteraction({ contactId: other.id, text: 'Not Bob', occurredStart: '2026-11-05T10:00:00.000Z', timezone: 'Europe/Paris' })

    expect((await getInteractionsByContact(contactId)).map((i) => i.id)).toEqual([newer.id, older.id])
  })

  it('cannot list the interactions of a deleted contact', async () => {
    await deleteContact(contactId)
    await expect(getInteractionsByContact(contactId)).rejects.toThrow('Contact not found.')
  })
})
