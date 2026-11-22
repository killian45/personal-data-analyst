import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createContact } from '../database/contacts'
import { createInteraction } from '../database/contactInteractions'
import { db } from '../database/db'
import { getDeviceTimezone, localDateTimeToUtc } from '../time/time'

import CrmPage from './CrmPage'

function renderPage() {
  render(<CrmPage displayTimezone="event" />)
}

async function openContact(name: string) {
  const list = await screen.findByRole('list', { name: 'Contacts' })
  await userEvent.click(within(list).getByRole('button', { name: new RegExp(name) }))
  return screen.findByRole('heading', { level: 3, name })
}

describe('CrmPage', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(async () => {
    cleanup()
    vi.restoreAllMocks()
    db.close()
    await db.delete()
  })

  it('creates a contact (name required) and opens its card', async () => {
    const user = userEvent.setup()
    renderPage()
    expect(await screen.findByText(/No contacts yet/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'New contact' }))
    const create = screen.getByRole('button', { name: 'Create contact' })
    expect(create).toBeDisabled()

    await user.type(screen.getByLabelText('Name (required)'), '  Amélie ')
    await user.type(screen.getByLabelText('Birthday'), '17/05')
    await user.type(screen.getByLabelText('Interests & likes'), 'Jazz')
    await user.click(create)

    expect(await screen.findByRole('heading', { level: 3, name: 'Amélie' })).toBeInTheDocument()
    expect(screen.getByText('Contact "Amélie" created.')).toBeInTheDocument()
    const stored = await db.contacts.toArray()
    expect(stored).toHaveLength(1)
    expect(stored[0]).toMatchObject({ name: 'Amélie', birthday: '--05-17', interests: 'Jazz', description: null })
  })

  it('refuses an invalid birthday without saving', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'New contact' }))
    await user.type(screen.getByLabelText('Name (required)'), 'Bob')
    await user.type(screen.getByLabelText('Birthday'), '31/02/1990')
    expect(screen.getByText(/Use 17\/05\/1990/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Create contact' }))
    expect(screen.getByRole('alert')).toHaveTextContent('day/month/year')
    expect(await db.contacts.count()).toBe(0)
  })

  it('searches the list by name or any detail, ignoring accents', async () => {
    await createContact({ name: 'Émile', interests: 'Chess' })
    await createContact({ name: 'Bob', address: 'Lyon' })
    const user = userEvent.setup()
    renderPage()

    const list = await screen.findByRole('list', { name: 'Contacts' })
    expect(within(list).getAllByRole('button')).toHaveLength(2)

    await user.type(screen.getByLabelText('Search contacts'), 'emile')
    expect(within(list).getAllByRole('button').map((b) => b.textContent)).toEqual([expect.stringContaining('Émile')])
    expect(screen.getByText('1 of 2 contacts')).toBeInTheDocument()

    await user.clear(screen.getByLabelText('Search contacts'))
    await user.type(screen.getByLabelText('Search contacts'), 'lyon')
    expect(within(list).getAllByRole('button').map((b) => b.textContent)).toEqual([expect.stringContaining('Bob')])
  })

  it('saves only the changed fields', async () => {
    const contact = await createContact({ name: 'Bob', interests: 'Chess', address: 'Lyon' })
    const user = userEvent.setup()
    renderPage()
    await openContact('Bob')

    const save = screen.getByRole('button', { name: 'Save changes' })
    expect(save).toBeDisabled()

    await user.type(screen.getByLabelText('Dislikes'), 'Noise')
    expect(save).toBeEnabled()
    await user.click(save)

    expect(await screen.findByText('Changes saved.')).toBeInTheDocument()
    expect(save).toBeDisabled()
    expect(await db.contacts.get(contact.id)).toEqual({
      ...contact,
      dislikes: 'Noise',
      revision: 2,
      updatedAt: expect.any(String),
    })
  })

  it('logs an interaction at the current time by default', async () => {
    const contact = await createContact({ name: 'Bob' })
    const user = userEvent.setup()
    renderPage()
    await openContact('Bob')

    const before = new Date().toISOString()
    await user.type(screen.getByLabelText('New interaction'), 'Coffee, talked about his new job')
    await user.click(screen.getByRole('button', { name: 'Log interaction' }))
    expect(await screen.findByText(/^Logged for/)).toBeInTheDocument()
    const after = new Date().toISOString()

    const [stored] = await db.contactInteractions.where('contactId').equals(contact.id).toArray()
    expect(stored).toMatchObject({ text: 'Coffee, talked about his new job', timezone: getDeviceTimezone() })
    expect(stored.occurredStart >= before && stored.occurredStart <= after).toBe(true)
    expect(within(screen.getByRole('list', { name: /Interactions with Bob/ })).getByText('Coffee, talked about his new job')).toBeInTheDocument()
    expect(screen.getByLabelText('New interaction')).toHaveValue('')
  })

  it('logs an interaction at a typed date and time (dd/mm/yyyy, 24-hour), in this device timezone', async () => {
    const contact = await createContact({ name: 'Bob' })
    const user = userEvent.setup()
    renderPage()
    await openContact('Bob')

    await user.type(screen.getByLabelText('New interaction'), 'Dinner')
    const date = screen.getByLabelText('When: date (dd/mm/yyyy)')
    const time = screen.getByLabelText('When: time (24-hour)')
    await user.clear(date)
    await user.type(date, '03/11/2026')
    await user.clear(time)
    await user.type(time, '20:15')
    await user.click(screen.getByRole('button', { name: 'Log interaction' }))

    expect(await screen.findByText('Logged for 03/11/2026 20:15.')).toBeInTheDocument()
    const [stored] = await db.contactInteractions.where('contactId').equals(contact.id).toArray()
    expect(stored.occurredStart).toBe(localDateTimeToUtc('2026-11-03T20:15', getDeviceTimezone()).utc)
  })

  it('shows interactions newest first; delete and undo', async () => {
    const contact = await createContact({ name: 'Bob' })
    const zone = getDeviceTimezone()
    await createInteraction({ contactId: contact.id, text: 'Older', occurredStart: localDateTimeToUtc('2026-11-01T10:00', zone).utc, timezone: zone })
    await createInteraction({ contactId: contact.id, text: 'Newer', occurredStart: localDateTimeToUtc('2026-11-10T10:00', zone).utc, timezone: zone })
    const user = userEvent.setup()
    renderPage()
    await openContact('Bob')

    const log = await screen.findByRole('list', { name: /Interactions with Bob/ })
    await waitFor(() => expect(within(log).getAllByRole('listitem')).toHaveLength(2))
    expect(within(log).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      expect.stringContaining('10/11/2026 10:00'),
      expect.stringContaining('01/11/2026 10:00'),
    ])

    await user.click(screen.getByRole('button', { name: 'Delete interaction of 10/11/2026 10:00' }))
    expect(await screen.findByText('Interaction of 10/11/2026 10:00 deleted.')).toBeInTheDocument()
    expect(within(log).getAllByRole('listitem')).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(await screen.findByText('Interaction restored.')).toBeInTheDocument()
    expect(within(log).getAllByRole('listitem')).toHaveLength(2)
  })

  it('edits an interaction (text and time)', async () => {
    const contact = await createContact({ name: 'Bob' })
    const zone = getDeviceTimezone()
    const interaction = await createInteraction({ contactId: contact.id, text: 'Lunch', occurredStart: localDateTimeToUtc('2026-11-10T12:00', zone).utc, timezone: zone })
    const user = userEvent.setup()
    renderPage()
    await openContact('Bob')

    await user.click(await screen.findByRole('button', { name: 'Edit interaction of 10/11/2026 12:00' }))
    const text = screen.getByLabelText('Interaction')
    await user.clear(text)
    await user.type(text, 'Lunch at Chez Marcel')
    const time = screen.getByLabelText(/^When \(time in .*\): time \(24-hour\)$/)
    await user.clear(time)
    await user.type(time, '13:30')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('Interaction updated.')).toBeInTheDocument()
    expect(await db.contactInteractions.get(interaction.id)).toMatchObject({
      text: 'Lunch at Chez Marcel',
      occurredStart: localDateTimeToUtc('2026-11-10T13:30', zone).utc,
      revision: 2,
    })
  })

  it('deletes a contact after confirmation, and undo brings it back', async () => {
    const contact = await createContact({ name: 'Bob' })
    const user = userEvent.setup()
    renderPage()
    await openContact('Bob')

    await user.click(screen.getByRole('button', { name: 'Delete contact' }))
    expect((await db.contacts.get(contact.id))?.deletedAt).toBeNull() // not yet
    await user.click(screen.getByRole('button', { name: 'Confirm delete' }))

    expect(await screen.findByText('Contact "Bob" deleted.')).toBeInTheDocument()
    expect((await db.contacts.get(contact.id))?.deletedAt).not.toBeNull()
    expect(screen.getByText(/No contacts yet/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(await screen.findByRole('heading', { level: 3, name: 'Bob' })).toBeInTheDocument()
    expect((await db.contacts.get(contact.id))?.deletedAt).toBeNull()
  })

  it('asks before leaving a contact with unsaved changes', async () => {
    await createContact({ name: 'Alice' })
    await createContact({ name: 'Bob' })
    const user = userEvent.setup()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderPage()
    await openContact('Alice')
    await user.type(screen.getByLabelText('Dislikes'), 'Noise')

    await user.click(within(screen.getByRole('list', { name: 'Contacts' })).getByRole('button', { name: /Bob/ }))
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('heading', { level: 3, name: 'Alice' })).toBeInTheDocument()
    expect(screen.getByLabelText('Dislikes')).toHaveValue('Noise')

    confirm.mockReturnValue(true)
    await user.click(within(screen.getByRole('list', { name: 'Contacts' })).getByRole('button', { name: /Bob/ }))
    expect(await screen.findByRole('heading', { level: 3, name: 'Bob' })).toBeInTheDocument()
  })

  it('shows changes that arrive from another device without losing what is being typed', async () => {
    const bob = await createContact({ name: 'Bob', interests: 'Chess' })
    const user = userEvent.setup()
    const { rerender } = render(<CrmPage displayTimezone="event" dataVersion={0} />)
    await openContact('Bob')

    // Not editing: a change synced from another device is shown.
    await db.contacts.put({ ...bob, interests: 'Chess, jazz', revision: 2, syncStatus: 'synced', syncedRevision: 2, updatedAt: '2026-11-12T18:00:00.000Z' })
    rerender(<CrmPage displayTimezone="event" dataVersion={1} />)
    await waitFor(() => expect(screen.getByLabelText('Interests & likes')).toHaveValue('Chess, jazz'))

    // Editing: the edits stay; saving sends only the edited field.
    await user.type(screen.getByLabelText('Dislikes'), 'Noise')
    await db.contacts.put({ ...bob, interests: 'Chess, jazz, opera', revision: 3, syncStatus: 'synced', syncedRevision: 3, updatedAt: '2026-11-12T18:05:00.000Z' })
    rerender(<CrmPage displayTimezone="event" dataVersion={2} />)
    await waitFor(async () => expect((await db.contacts.get(bob.id))?.revision).toBe(3))
    expect(screen.getByLabelText('Dislikes')).toHaveValue('Noise')

    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByText('Changes saved.')).toBeInTheDocument()
    expect(await db.contacts.get(bob.id)).toMatchObject({ interests: 'Chess, jazz, opera', dislikes: 'Noise', revision: 4 })
    expect(screen.getByLabelText('Interests & likes')).toHaveValue('Chess, jazz, opera')
  })
})

