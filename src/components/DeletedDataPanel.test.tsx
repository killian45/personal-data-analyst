import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createContact, deleteContact } from '../database/contacts'
import { createInteraction, deleteInteraction } from '../database/contactInteractions'
import { db } from '../database/db'
import { createEntry, deleteEntry } from '../database/entries'
import { createHabit, deleteHabit } from '../database/habits'
import { createManualSleepSession, deleteSleepSession } from '../database/sleepSessions'
import { locationSamples } from '../location/testLocation'
import { screenTimeSample } from '../screenTime/testScreenTime'

import { DeletedDataPanel } from './DeletedDataPanel'

const START = '2026-11-09T08:00:00.000Z'

describe('DeletedDataPanel', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(async () => {
    cleanup()
    db.close()
    await db.delete()
  })

  it('says when nothing has been deleted', async () => {
    render(<DeletedDataPanel displayTimezone="event" />)

    expect(await screen.findByText('Nothing has been deleted.')).toBeInTheDocument()
  })

  it('restores a deleted habit together with its entries', async () => {
    const water = await createHabit({ name: 'Water', type: 'number' })
    await createEntry({ habitId: water.id, value: 1, occurredStart: START })
    await deleteHabit(water.id)
    const onHabitRestored = vi.fn()

    render(<DeletedDataPanel displayTimezone="event" onHabitRestored={onHabitRestored} />)

    expect(await screen.findByText(/1 entry will reappear/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Restore habit Water' }))

    expect(await screen.findByText('Restored: Water.')).toBeInTheDocument()
    expect(screen.getByText('Nothing has been deleted.')).toBeInTheDocument()
    expect(onHabitRestored).toHaveBeenCalledOnce()
    expect((await db.habits.get(water.id))?.deletedAt).toBeNull()
  })

  it('restores a deleted entry', async () => {
    const water = await createHabit({ name: 'Water', type: 'number', unit: 'ml' })
    const entry = await createEntry({
      habitId: water.id,
      value: 500,
      occurredStart: START,
      timezone: 'Europe/Paris',
      comment: 'Morning',
    })
    await deleteEntry(entry.id)

    render(<DeletedDataPanel displayTimezone="event" />)

    expect(await screen.findByText('Deleted entries (1)')).toBeInTheDocument()
    expect(screen.getByText('Morning')).toBeInTheDocument()
    expect(screen.getByText(/500 ml/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /^Restore entry Water/ }))

    expect(await screen.findByText(/^Restored: Water/)).toBeInTheDocument()
    expect((await db.entries.get(entry.id))?.deletedAt).toBeNull()
  })

  it('asks to restore the habit first when an entry belongs to a deleted habit', async () => {
    const gym = await createHabit({ name: 'Gym', type: 'checkbox' })
    const entry = await createEntry({ habitId: gym.id, value: true, occurredStart: START })
    await deleteEntry(entry.id)
    await deleteHabit(gym.id)

    render(<DeletedDataPanel displayTimezone="event" />)

    expect(await screen.findByText(/restore the habit first/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Restore entry Gym/ })).toBeDisabled()
  })

  it('restores a deleted sleep session', async () => {
    const session = await createManualSleepSession({
      startUtc: '2026-11-08T22:30:00.000Z',
      endUtc: '2026-11-09T06:15:00.000Z',
      timezone: 'Europe/Paris',
    })
    await deleteSleepSession(session.id)

    render(<DeletedDataPanel displayTimezone="event" />)

    expect(await screen.findByText('Deleted sleep sessions (1)')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /^Restore Sleep/ }))

    expect(await screen.findByText(/^Restored: Sleep/)).toBeInTheDocument()
    expect((await db.sleepSessions.get(session.id))?.deletedAt).toBeNull()
  })

  it('restores a deleted screen-time day', async () => {
    await db.externalSamples.add(screenTimeSample('st-9', '2026-11-09', { deletedAt: '2026-11-10T09:00:00.000Z', revision: 2 }))

    render(<DeletedDataPanel displayTimezone="event" />)

    expect(await screen.findByText('Deleted screen-time days (1)')).toBeInTheDocument()
    expect(screen.getByText(/1 h 13 min \(2 apps\)/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /^Restore Screen time, Mon 9 Nov 2026/ }))

    expect(await screen.findByText(/^Restored: Screen time/)).toBeInTheDocument()
    expect(await db.externalSamples.get('st-9')).toMatchObject({ deletedAt: null, revision: 3 })
  })

  it('restores a deleted location visit', async () => {
    const [visit] = locationSamples()
    await db.externalSamples.add({ ...visit, deletedAt: '2026-11-10T09:00:00.000Z', revision: 2 })

    render(<DeletedDataPanel displayTimezone="event" />)

    expect(await screen.findByText('Deleted location visits and movements (1)')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^Restore Location/ }))
    expect(await screen.findByText(/^Restored: Location/)).toBeInTheDocument()
    expect((await db.externalSamples.get('visit-1'))?.deletedAt).toBeNull()
  })

  it('lists deleted contacts and interactions; an interaction of a deleted contact waits for its contact', async () => {
    const bob = await createContact({ name: 'Bob' })
    await createInteraction({ contactId: bob.id, text: 'Kept lunch', occurredStart: START, timezone: 'Europe/Paris' })
    const call = await createInteraction({ contactId: bob.id, text: 'Deleted call', occurredStart: START, timezone: 'Europe/Paris' })
    await deleteInteraction(call.id)
    await deleteContact(bob.id)

    render(<DeletedDataPanel displayTimezone="event" />)
    expect(await screen.findByText('Deleted contacts (1)')).toBeInTheDocument()
    expect(screen.getByText(/1 interaction will reappear/)).toBeInTheDocument()
    expect(screen.getByText('Deleted contact interactions (1)')).toBeInTheDocument()
    expect(screen.getByText(/09\/11\/2026 09:00/)).toBeInTheDocument() // 08:00 UTC shown in Paris
    const restoreCall = screen.getByRole('button', { name: 'Restore interaction with Bob, 09/11/2026 09:00' })
    expect(restoreCall).toBeDisabled()
    expect(screen.getByText(/restore the contact first/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Restore contact Bob' }))
    expect(await screen.findByText('Restored: Bob.')).toBeInTheDocument()
    expect((await db.contacts.get(bob.id))?.deletedAt).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Restore interaction with Bob, 09/11/2026 09:00' }))
    expect(await screen.findByText('Restored: interaction with Bob, 09/11/2026 09:00.')).toBeInTheDocument()
    expect((await db.contactInteractions.get(call.id))?.deletedAt).toBeNull()
  })
})
