import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { db } from '../database/db'
import { createEntry } from '../database/entries'
import { createHabit } from '../database/habits'
import { createManualSleepSession } from '../database/sleepSessions'
import { locationSamples } from '../location/testLocation'
import { screenTimeSample } from '../screenTime/testScreenTime'

import { PersonalDataLog } from './PersonalDataLog'

function bodyRows() {
  const [, body] = screen.getAllByRole('rowgroup')
  return within(body).getAllByRole('row')
}

describe('PersonalDataLog', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(async () => {
    cleanup()
    db.close()
    await db.delete()
  })

  it('shows an empty state when there are no entries', async () => {
    render(<PersonalDataLog />)

    expect(await screen.findByText('No entries yet. Log your first entry in Data Logging.')).toBeInTheDocument()
  })

  it('shows entries with all columns, newest first', async () => {
    const water = await createHabit({ name: 'Water', type: 'number', unit: 'ml' })
    await createEntry({ habitId: water.id, value: 500, occurredStart: '2026-11-08T08:00:00.000Z', timezone: 'Europe/Paris', comment: 'Morning' })
    await createEntry({ habitId: water.id, value: 250, occurredStart: '2026-11-09T08:00:00.000Z', timezone: 'Europe/Paris' })

    render(<PersonalDataLog />)

    expect(await screen.findByText('Showing 1–2 of 2 entries')).toBeInTheDocument()

    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent?.replace(/[▲▼]/g, '').trim())
    expect(headers).toEqual(['Date', 'Time', 'Habit', 'Type', 'Value', 'Unit', 'Source', 'Comment', 'Actions'])

    const [first, second] = bodyRows()
    expect(first).toHaveTextContent('Mon 9 Nov 2026')
    expect(first).toHaveTextContent('09:00')
    expect(first).toHaveTextContent('250')
    expect(second).toHaveTextContent('Morning')
    expect(second).toHaveTextContent('ml')
    expect(second).toHaveTextContent('Manual')
  })

  it('searches, shows a no-match state and clears the filters', async () => {
    const water = await createHabit({ name: 'Water', type: 'number' })
    const mood = await createHabit({ name: 'Mood', type: 'label', labelOptions: ['Good', 'Bad'] })
    await createEntry({ habitId: water.id, value: 500, occurredStart: '2026-11-08T08:00:00.000Z' })
    await createEntry({ habitId: mood.id, value: 'Good', occurredStart: '2026-11-09T08:00:00.000Z' })

    render(<PersonalDataLog />)

    const search = await screen.findByLabelText('Search')
    await userEvent.type(search, 'good')

    expect(screen.getByText('Showing 1–1 of 1 entry')).toBeInTheDocument()
    expect(bodyRows()).toHaveLength(1)

    await userEvent.clear(search)
    await userEvent.type(search, 'zzz')

    expect(screen.getByText('No entries match your search or filters.')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Clear search and filters' }))

    expect(screen.getByText('Showing 1–2 of 2 entries')).toBeInTheDocument()
  })

  it('filters by habit', async () => {
    const water = await createHabit({ name: 'Water', type: 'number' })
    const gym = await createHabit({ name: 'Gym', type: 'checkbox' })
    await createEntry({ habitId: water.id, value: 1, occurredStart: '2026-11-08T08:00:00.000Z' })
    await createEntry({ habitId: gym.id, value: true, occurredStart: '2026-11-09T08:00:00.000Z' })

    render(<PersonalDataLog />)

    await userEvent.selectOptions(await screen.findByLabelText('Habit'), 'Gym')

    expect(bodyRows()).toHaveLength(1)
    expect(bodyRows()[0]).toHaveTextContent('Done')
  })

  it('filters by dates typed as dd/mm/yyyy and ignores incomplete dates', async () => {
    const water = await createHabit({ name: 'Water', type: 'number' })
    // 08:00 UTC = 09:00 in Paris, same calendar day
    await createEntry({ habitId: water.id, value: 1, occurredStart: '2026-11-07T08:00:00.000Z', timezone: 'Europe/Paris' })
    await createEntry({ habitId: water.id, value: 2, occurredStart: '2026-11-08T08:00:00.000Z', timezone: 'Europe/Paris' })
    await createEntry({ habitId: water.id, value: 3, occurredStart: '2026-11-09T08:00:00.000Z', timezone: 'Europe/Paris' })

    render(<PersonalDataLog />)

    const from = await screen.findByLabelText('From')
    const to = screen.getByLabelText('To')

    await userEvent.type(from, '08/11/20')
    // Incomplete: no filter applied yet, and no error while typing.
    expect(screen.getByText('Showing 1–3 of 3 entries')).toBeInTheDocument()

    await userEvent.type(from, '26')
    await userEvent.type(to, '08/11/2026')

    expect(screen.getByText('Showing 1–1 of 1 entry')).toBeInTheDocument()
    expect(bodyRows()[0]).toHaveTextContent('Sun 8 Nov 2026')

    await userEvent.click(screen.getByRole('button', { name: 'Clear search and filters' }))

    expect(from).toHaveValue('')
    expect(screen.getByText('Showing 1–3 of 3 entries')).toBeInTheDocument()
  })

  it('sorts when a column header is clicked', async () => {
    const water = await createHabit({ name: 'Water', type: 'number' })
    await createEntry({ habitId: water.id, value: 3, occurredStart: '2026-11-07T08:00:00.000Z' })
    await createEntry({ habitId: water.id, value: 1, occurredStart: '2026-11-08T08:00:00.000Z' })
    await createEntry({ habitId: water.id, value: 2, occurredStart: '2026-11-09T08:00:00.000Z' })

    render(<PersonalDataLog />)

    const valueButton = await screen.findByRole('button', { name: /^Value/ })
    await userEvent.click(valueButton)

    expect(screen.getByRole('columnheader', { name: /Value/ })).toHaveAttribute('aria-sort', 'ascending')
    expect(bodyRows().map((r) => within(r).getAllByRole('cell')[4].textContent)).toEqual(['1', '2', '3'])

    await userEvent.click(valueButton)

    expect(screen.getByRole('columnheader', { name: /Value/ })).toHaveAttribute('aria-sort', 'descending')
    expect(bodyRows().map((r) => within(r).getAllByRole('cell')[4].textContent)).toEqual(['3', '2', '1'])
  })

  it('renders only one page of 50 rows at a time', async () => {
    const water = await createHabit({ name: 'Water', type: 'number' })

    await db.transaction('rw', db.habits, db.entries, async () => {
      for (let index = 0; index < 60; index += 1) {
        await createEntry({
          habitId: water.id,
          value: index,
          occurredStart: new Date(Date.UTC(2026, 0, 1) + index * 3_600_000).toISOString(),
        })
      }
    })

    render(<PersonalDataLog />)

    expect(await screen.findByText('Showing 1–50 of 60 entries')).toBeInTheDocument()
    expect(bodyRows()).toHaveLength(50)
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Next' }))

    expect(screen.getByText('Showing 51–60 of 60 entries')).toBeInTheDocument()
    expect(bodyRows()).toHaveLength(10)
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
  })

  describe('editing, deleting and undo', () => {
    // 13:30:42.5 UTC = 14:30 in Paris; the seconds must survive edits.
    const START = '2026-11-09T13:30:42.500Z'

    async function setupWater() {
      const water = await createHabit({ name: 'Water', type: 'number', unit: 'ml' })
      const entry = await createEntry({
        habitId: water.id,
        value: 500,
        occurredStart: START,
        timezone: 'Europe/Paris',
        comment: 'Morning',
      })
      return { water, entry }
    }

    it('edits a value from the table', async () => {
      const { entry } = await setupWater()

      render(<PersonalDataLog />)

      await userEvent.click(await screen.findByRole('button', { name: /^Edit Water/ }))

      const value = screen.getByLabelText('Value (ml)')
      await userEvent.clear(value)
      await userEvent.type(value, '750,5')
      await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

      expect(await screen.findByText('Entry updated.')).toBeInTheDocument()
      expect(screen.queryByRole('form', { name: /Edit Water/ })).not.toBeInTheDocument()
      expect(bodyRows()[0]).toHaveTextContent('750.5')

      const stored = await db.entries.get(entry.id)
      expect(stored).toMatchObject({ value: 750.5, occurredStart: START, revision: 2 })
    })

    it('keeps the exact original time when only the comment is edited', async () => {
      const { entry } = await setupWater()

      render(<PersonalDataLog />)

      await userEvent.click(await screen.findByRole('button', { name: /^Edit Water/ }))

      const comment = screen.getByLabelText('Comment (optional)')
      await userEvent.clear(comment)
      await userEvent.type(comment, 'Evening')
      await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

      await screen.findByText('Entry updated.')
      expect(await db.entries.get(entry.id)).toMatchObject({
        comment: 'Evening',
        occurredStart: START,
      })
    })

    it('moves an entry to another date and time typed as dd/mm/yyyy and 24-hour', async () => {
      const { entry } = await setupWater()

      render(<PersonalDataLog />)

      await userEvent.click(await screen.findByRole('button', { name: /^Edit Water/ }))

      fireEvent.change(screen.getByLabelText('Date and time: date (dd/mm/yyyy)'), { target: { value: '08/11/2026' } })
      fireEvent.change(screen.getByLabelText('Date and time: time (24-hour)'), { target: { value: '07h15' } })
      await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

      await screen.findByText('Entry updated.')
      // 07:15 in Paris (UTC+1) = 06:15 UTC
      expect((await db.entries.get(entry.id))?.occurredStart).toBe('2026-11-08T06:15:00.000Z')
      expect(bodyRows()[0]).toHaveTextContent('Sun 8 Nov 2026')
    })

    it('shows validation errors inside the form and changes nothing', async () => {
      const { entry } = await setupWater()

      render(<PersonalDataLog />)

      await userEvent.click(await screen.findByRole('button', { name: /^Edit Water/ }))

      const value = screen.getByLabelText('Value (ml)')
      await userEvent.clear(value)
      await userEvent.type(value, 'abc')
      await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

      expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid number')
      expect((await db.entries.get(entry.id))?.value).toBe(500)

      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(screen.queryByRole('form', { name: /Edit Water/ })).not.toBeInTheDocument()
    })

    it('edits the end of a stopwatch session', async () => {
      const reading = await createHabit({ name: 'Reading', type: 'stopwatch' })
      const entry = await createEntry({
        habitId: reading.id,
        value: null,
        occurredStart: '2026-11-09T07:00:00.000Z',
        occurredEnd: '2026-11-09T08:05:00.000Z',
        timezone: 'Europe/Paris',
      })

      render(<PersonalDataLog />)

      await userEvent.click(await screen.findByRole('button', { name: /^Edit Reading/ }))

      fireEvent.change(screen.getByLabelText('End: time (24-hour)'), { target: { value: '09:30' } })
      await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

      await screen.findByText('Entry updated.')
      expect(await db.entries.get(entry.id)).toMatchObject({
        occurredEnd: '2026-11-09T08:30:00.000Z',
        value: { segments: [{ start: '2026-11-09T07:00:00.000Z', end: '2026-11-09T08:30:00.000Z' }] },
      })
      expect(bodyRows()[0]).toHaveTextContent('1 h 30 min')
    })

    it('edits the start of a session with pauses and keeps the pauses', async () => {
      const reading = await createHabit({ name: 'Reading', type: 'stopwatch' })
      const entry = await createEntry({
        habitId: reading.id,
        value: {
          segments: [
            { start: '2026-11-09T07:00:00.000Z', end: '2026-11-09T07:30:00.000Z' },
            { start: '2026-11-09T07:45:00.000Z', end: '2026-11-09T08:05:00.000Z' },
          ],
        },
        timezone: 'Europe/Paris',
      })

      render(<PersonalDataLog />)

      await userEvent.click(await screen.findByRole('button', { name: /^Edit Reading/ }))

      expect(screen.getByText(/This session has pauses/)).toBeInTheDocument()

      // Paris 08:00 → 07:40
      fireEvent.change(screen.getByLabelText('Start: time (24-hour)'), { target: { value: '07:40' } })
      await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

      await screen.findByText('Entry updated.')
      expect(await db.entries.get(entry.id)).toMatchObject({
        occurredStart: '2026-11-09T06:40:00.000Z',
        occurredEnd: '2026-11-09T08:05:00.000Z',
        value: {
          segments: [
            { start: '2026-11-09T06:40:00.000Z', end: '2026-11-09T07:30:00.000Z' },
            { start: '2026-11-09T07:45:00.000Z', end: '2026-11-09T08:05:00.000Z' },
          ],
        },
      })
      // 50 + 20 minutes active
      expect(bodyRows()[0]).toHaveTextContent('1 h 10 min (2 periods)')
    })

    it('deletes an entry and restores it with Undo', async () => {
      const water = await createHabit({ name: 'Water', type: 'number' })
      const kept = await createEntry({ habitId: water.id, value: 1, occurredStart: '2026-11-08T08:00:00.000Z' })
      const removed = await createEntry({ habitId: water.id, value: 2, occurredStart: '2026-11-09T08:00:00.000Z' })

      render(<PersonalDataLog />)

      await screen.findByText('Showing 1–2 of 2 entries')

      const firstRow = bodyRows()[0]
      await userEvent.click(within(firstRow).getByRole('button', { name: /^Delete Water/ }))

      expect(await screen.findByText(/^Deleted: Water/)).toBeInTheDocument()
      expect(screen.getByText('Showing 1–1 of 1 entry')).toBeInTheDocument()
      expect((await db.entries.get(removed.id))?.deletedAt).not.toBeNull()

      await userEvent.click(screen.getByRole('button', { name: 'Undo' }))

      expect(await screen.findByText('Entry restored.')).toBeInTheDocument()
      expect(screen.getByText('Showing 1–2 of 2 entries')).toBeInTheDocument()
      expect((await db.entries.get(removed.id))?.deletedAt).toBeNull()
      expect((await db.entries.get(kept.id))?.deletedAt).toBeNull()
    })

    it('keeps Undo available after deleting the last entry', async () => {
      const { entry } = await setupWater()

      render(<PersonalDataLog />)

      await userEvent.click(await screen.findByRole('button', { name: /^Delete Water/ }))

      expect(await screen.findByText('No entries yet. Log your first entry in Data Logging.')).toBeInTheDocument()
      expect(screen.getByText(/^Deleted: Water/)).toBeInTheDocument()

      await userEvent.click(screen.getByRole('button', { name: 'Undo' }))

      expect(await screen.findByText('Showing 1–1 of 1 entry')).toBeInTheDocument()
      expect((await db.entries.get(entry.id))?.deletedAt).toBeNull()
    })

    it('hides the Undo bar when dismissed', async () => {
      await setupWater()

      render(<PersonalDataLog />)

      await userEvent.click(await screen.findByRole('button', { name: /^Delete Water/ }))
      await userEvent.click(await screen.findByRole('button', { name: 'Dismiss' }))

      expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument()
    })
  })

  describe('sleep sessions', () => {
    async function logNight() {
      return createManualSleepSession({
        startUtc: '2026-11-08T22:30:00.000Z',
        endUtc: '2026-11-09T06:15:00.000Z',
        timezone: 'Europe/Paris',
      })
    }

    it('shows sleep sessions as Sleep rows and filters them', async () => {
      await logNight()
      const water = await createHabit({ name: 'Water', type: 'number' })
      await createEntry({ habitId: water.id, value: 1, occurredStart: '2026-11-09T08:00:00.000Z' })

      render(<PersonalDataLog />)

      expect(await screen.findByText('Showing 1–2 of 2 entries')).toBeInTheDocument()
      expect(screen.getByText('7 h 45 min in bed')).toBeInTheDocument()

      await userEvent.selectOptions(screen.getByLabelText('Type'), 'Sleep')

      expect(bodyRows()).toHaveLength(1)
      expect(bodyRows()[0]).toHaveTextContent('23:30–07:15 (next day or later)')
    })

    it('edits the wake time of a manual session', async () => {
      const session = await logNight()

      render(<PersonalDataLog />)

      await userEvent.click(await screen.findByRole('button', { name: /^Edit Sleep/ }))
      fireEvent.change(screen.getByLabelText('Wake time: time (24-hour)'), { target: { value: '07:45' } })
      await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

      expect(await screen.findByText('Entry updated.')).toBeInTheDocument()
      expect((await db.sleepSessions.get(session.id))?.endUtc).toBe('2026-11-09T06:45:00.000Z')
      expect(screen.getByText('8 h 15 min in bed')).toBeInTheDocument()
    })

    it('only offers the comment for an imported session', async () => {
      const session = await logNight()
      await db.sleepSessions.update(session.id, {
        source: 'health_connect',
        externalId: 'hc-1',
        dedupeKey: 'health_connect:id:hc-1',
      })

      render(<PersonalDataLog />)

      await userEvent.click(await screen.findByRole('button', { name: /^Edit Sleep/ }))

      expect(screen.getByText(/This session was imported/)).toBeInTheDocument()
      expect(screen.queryByLabelText('Wake time: time (24-hour)')).not.toBeInTheDocument()
    })

    it('deletes a sleep session and restores it with Undo', async () => {
      const session = await logNight()

      render(<PersonalDataLog />)

      await userEvent.click(await screen.findByRole('button', { name: /^Delete Sleep/ }))

      expect(await screen.findByText(/^Deleted: Sleep/)).toBeInTheDocument()
      expect((await db.sleepSessions.get(session.id))?.deletedAt).not.toBeNull()

      await userEvent.click(screen.getByRole('button', { name: 'Undo' }))

      expect(await screen.findByText('Entry restored.')).toBeInTheDocument()
      expect((await db.sleepSessions.get(session.id))?.deletedAt).toBeNull()
    })
  })

  describe('screen time', () => {
    it('shows imported days as Screen time rows, without Edit, and filters them', async () => {
      await db.externalSamples.add(screenTimeSample('st-9'))
      await db.externalSamples.add(screenTimeSample('st-gone', '2026-11-08', { deletedAt: '2026-11-10T09:00:00.000Z' }))
      const water = await createHabit({ name: 'Water', type: 'number' })
      await createEntry({ habitId: water.id, value: 1, occurredStart: '2026-11-09T08:00:00.000Z' })

      render(<PersonalDataLog />)

      expect(await screen.findByText('Showing 1–2 of 2 entries')).toBeInTheDocument()
      expect(screen.getByText('1 h 13 min (2 apps)')).toBeInTheDocument()
      expect(screen.getByText('Import (App Usage)')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /^Edit Screen time/ })).not.toBeInTheDocument()

      await userEvent.selectOptions(screen.getByLabelText('Type'), 'Screen time')
      expect(bodyRows()).toHaveLength(1)
      expect(bodyRows()[0]).toHaveTextContent('Whole day')
    })

    it('deletes a day and restores it with Undo', async () => {
      await db.externalSamples.add(screenTimeSample('st-9'))

      render(<PersonalDataLog />)

      await userEvent.click(await screen.findByRole('button', { name: /^Delete Screen time/ }))
      expect(await screen.findByText('No entries yet. Log your first entry in Data Logging.')).toBeInTheDocument()
      expect((await db.externalSamples.get('st-9'))?.deletedAt).not.toBeNull()

      await userEvent.click(screen.getByRole('button', { name: 'Undo' }))
      expect(await screen.findByText('Entry restored.')).toBeInTheDocument()
      expect((await db.externalSamples.get('st-9'))?.deletedAt).toBeNull()
    })
  })

  describe('location', () => {
    it('shows visits and movements as Location rows, without Edit, and deletes with Undo', async () => {
      await db.externalSamples.bulkAdd(locationSamples())

      render(<PersonalDataLog />)

      expect(await screen.findByText('Showing 1–2 of 2 entries')).toBeInTheDocument()
      expect(screen.getByText('Home · 4 h 00 min')).toBeInTheDocument()
      expect(screen.getByText('Cycling · 3.2 km · 20 min')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /^Edit Location/ })).not.toBeInTheDocument()

      await userEvent.selectOptions(screen.getByLabelText('Habit'), 'Location')
      expect(bodyRows()).toHaveLength(2)

      await userEvent.click(screen.getAllByRole('button', { name: /^Delete Location/ })[0])
      expect(await screen.findByText('Showing 1–1 of 1 entry')).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Undo' }))
      expect(await screen.findByText('Entry restored.')).toBeInTheDocument()
      expect((await db.externalSamples.toArray()).every((sample) => sample.deletedAt === null)).toBe(true)
    })
  })
})
