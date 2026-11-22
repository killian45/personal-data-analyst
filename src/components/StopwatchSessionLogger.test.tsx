import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { db } from '../database/db'
import { createEntry } from '../database/entries'
import { createHabit } from '../database/habits'
import type { Habit } from '../database/types'

import { StopwatchSessionLogger } from './StopwatchSessionLogger'

const habit: Habit = {
  id: 'h1',
  name: 'Reading',
  type: 'stopwatch',
  unit: null,
  labelOptions: null,
  color: '#2563eb',
  archived: false,
  sortOrder: 0,
  syncStatus: 'pending',
  revision: 1,
  syncedRevision: null,
  createdAt: '2026-11-01T10:00:00.000Z',
  updatedAt: '2026-11-01T10:00:00.000Z',
  deletedAt: null,
}

function setField(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

async function openAndFill(start: [string, string], end: [string, string], timezone = 'Europe/Paris') {
  await userEvent.click(screen.getByRole('button', { name: 'Log a past session' }))

  const zone = screen.getByLabelText('Timezone')
  await userEvent.clear(zone)
  await userEvent.type(zone, timezone)

  setField('Start: date (dd/mm/yyyy)', start[0])
  setField('Start: time (24-hour)', start[1])
  setField('End: date (dd/mm/yyyy)', end[0])
  setField('End: time (24-hour)', end[1])
}

describe('StopwatchSessionLogger', () => {
  afterEach(() => {
    cleanup()
  })

  it('pre-fills the last hour in 24-hour format', async () => {
    render(<StopwatchSessionLogger habit={habit} onCreateEntry={vi.fn()} />)

    await userEvent.click(screen.getByRole('button', { name: 'Log a past session' }))

    const startTime = (screen.getByLabelText('Start: time (24-hour)') as HTMLInputElement).value
    const endTime = (screen.getByLabelText('End: time (24-hour)') as HTMLInputElement).value

    expect(startTime).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/)
    expect(endTime).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/)
    expect(screen.getByText('Duration: 1 h 00 min')).toBeInTheDocument()
  })

  it('shows the duration and saves the session', async () => {
    const onCreateEntry = vi.fn(async () => {})

    render(<StopwatchSessionLogger habit={habit} onCreateEntry={onCreateEntry} />)

    await openAndFill(['09/11/2026', '08:00'], ['09/11/2026', '09:05'])

    expect(screen.getByText('Duration: 1 h 05 min')).toBeInTheDocument()

    await userEvent.type(screen.getByLabelText('Comment (optional)'), 'Novel')
    await userEvent.click(screen.getByRole('button', { name: 'Save session' }))

    expect(onCreateEntry).toHaveBeenCalledWith({
      habitId: 'h1',
      value: null,
      occurredStart: '2026-11-09T07:00:00.000Z',
      occurredEnd: '2026-11-09T08:05:00.000Z',
      timezone: 'Europe/Paris',
      comment: 'Next experiment: Novel',
    })
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Saved a 1 h 05 min session starting 9 Nov, 08:00.',
    )
  })

  it('refuses an end before the start', async () => {
    const onCreateEntry = vi.fn(async () => {})

    render(<StopwatchSessionLogger habit={habit} onCreateEntry={onCreateEntry} />)

    await openAndFill(['09/11/2026', '10:00'], ['09/11/2026', '09:00'])

    expect(screen.getByText('Duration: —')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Save session' }))

    expect(onCreateEntry).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('The end must be after the start.')
  })

  it('warns about sessions longer than 24 hours without blocking them', async () => {
    const onCreateEntry = vi.fn(async () => {})

    render(<StopwatchSessionLogger habit={habit} onCreateEntry={onCreateEntry} />)

    await openAndFill(['07/11/2026', '08:00'], ['09/11/2026', '09:00'])

    expect(screen.getByText('This session lasts more than 24 hours. Check the dates.')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Save session' }))

    expect(onCreateEntry).toHaveBeenCalledOnce()
  })

  it('shows database errors', async () => {
    const onCreateEntry = vi.fn(async () => {
      throw new Error('Cannot log entries for an archived habit.')
    })

    render(<StopwatchSessionLogger habit={habit} onCreateEntry={onCreateEntry} />)

    await openAndFill(['09/11/2026', '08:00'], ['09/11/2026', '09:00'])
    await userEvent.click(screen.getByRole('button', { name: 'Save session' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Cannot log entries for an archived habit.',
    )
  })

  describe('with the real database', () => {
    afterEach(async () => {
      db.close()
      await db.delete()
    })

    it('stores a stopwatch entry with one period', async () => {
      await db.delete()
      await db.open()

      const stored = await createHabit({ name: 'Reading', type: 'stopwatch' })

      render(<StopwatchSessionLogger habit={stored} onCreateEntry={createEntry} />)

      await openAndFill(['09/11/2026', '08:00'], ['09/11/2026', '09:05'])
      await userEvent.click(screen.getByRole('button', { name: 'Save session' }))
      await screen.findByRole('status')

      const entries = await db.entries.toArray()

      expect(entries).toHaveLength(1)
      expect(entries[0]).toMatchObject({
        habitType: 'stopwatch',
        occurredStart: '2026-11-09T07:00:00.000Z',
        occurredEnd: '2026-11-09T08:05:00.000Z',
        value: {
          segments: [{ start: '2026-11-09T07:00:00.000Z', end: '2026-11-09T08:05:00.000Z' }],
        },
        timezone: 'Europe/Paris',
      })
    })
  })
})
