import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { db } from '../database/db'
import { createEntry } from '../database/entries'
import { createHabit } from '../database/habits'
import type { Habit } from '../database/types'

import { EntryLogger } from './EntryLogger'

const BASE = {
  id: 'h1',
  name: 'Test habit',
  color: '#2563eb',
  archived: false,
  sortOrder: 0,
  syncStatus: 'pending' as const,
  revision: 1,
  syncedRevision: null,
  createdAt: '2026-11-01T10:00:00.000Z',
  updatedAt: '2026-11-01T10:00:00.000Z',
  deletedAt: null,
}

const numberHabit: Habit = { ...BASE, name: 'Water', type: 'number', unit: 'ml', labelOptions: null, dailyAggregation: 'sum', target: null }
const checkboxHabit: Habit = { ...BASE, type: 'checkbox', unit: null, labelOptions: null }
const labelHabit: Habit = { ...BASE, type: 'label', unit: null, labelOptions: ['Good', 'Bad'] }
const textHabit: Habit = { ...BASE, type: 'text', unit: null, labelOptions: null }

function setDateTime(date: string, time: string) {
  fireEvent.change(screen.getByLabelText('Date and time: date (dd/mm/yyyy)'), {
    target: { value: date },
  })
  fireEvent.change(screen.getByLabelText('Date and time: time (24-hour)'), {
    target: { value: time },
  })
}

describe('EntryLogger', () => {
  afterEach(() => {
    cleanup()
  })

  it('logs a checkbox habit with one click, in the device timezone', async () => {
    const onCreateEntry = vi.fn(async () => {})

    render(<EntryLogger habit={checkboxHabit} onCreateEntry={onCreateEntry} />)

    await userEvent.click(screen.getByRole('button', { name: 'Done' }))

    expect(onCreateEntry).toHaveBeenCalledOnce()
    expect(onCreateEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        habitId: 'h1',
        value: true,
        // Tests run with TZ=America/New_York.
        timezone: 'America/New_York',
      }),
    )
    expect(await screen.findByRole('status')).toHaveTextContent('Saved for')
  })

  it('logs "Not done" explicitly as false', async () => {
    const onCreateEntry = vi.fn(async () => {})

    render(<EntryLogger habit={checkboxHabit} onCreateEntry={onCreateEntry} />)

    await userEvent.click(screen.getByRole('button', { name: 'Not done' }))

    expect(onCreateEntry).toHaveBeenCalledWith(expect.objectContaining({ value: false }))
  })

  it('logs one label: choose it, then click Log', async () => {
    const onCreateEntry = vi.fn(async () => {})

    render(<EntryLogger habit={labelHabit} onCreateEntry={onCreateEntry} />)

    const log = screen.getByRole('button', { name: 'Log' })
    expect(log).toBeDisabled()

    await userEvent.click(screen.getByRole('button', { name: 'Bad' }))
    expect(onCreateEntry).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '✓ Bad' })).toHaveAttribute('aria-pressed', 'true')

    await userEvent.click(log)

    expect(onCreateEntry).toHaveBeenCalledWith(expect.objectContaining({ value: 'Bad' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Saved Bad for')
    // The choice is cleared after saving.
    expect(screen.getByRole('button', { name: 'Bad' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('logs several labels at once: one entry each, same time and comment', async () => {
    const onCreateEntry = vi.fn(async () => {})
    const onCreateEntries = vi.fn(async (_inputs: unknown[]) => {})
    const habit: Habit = { ...labelHabit, labelOptions: ['Love', 'Pride', 'Fear'] }

    render(
      <EntryLogger habit={habit} onCreateEntry={onCreateEntry} onCreateEntries={onCreateEntries} />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Fear' }))
    await userEvent.click(screen.getByRole('button', { name: 'Love' }))
    await userEvent.click(screen.getByRole('button', { name: 'Log 2 labels' }))

    expect(onCreateEntry).not.toHaveBeenCalled()
    expect(onCreateEntries).toHaveBeenCalledTimes(1)
    const inputs = onCreateEntries.mock.calls[0][0] as { value: string; occurredStart: string; comment: string | null }[]
    // Saved in the habit's order, not the click order.
    expect(inputs.map((input) => input.value)).toEqual(['Love', 'Fear'])
    expect(inputs[0].occurredStart).toBe(inputs[1].occurredStart)
    expect(inputs[0].comment).toBe(inputs[1].comment)
    expect(await screen.findByRole('status')).toHaveTextContent('Saved Love, Fear for')
  })

  it('un-chooses a label with a second click and clears the choice', async () => {
    const onCreateEntry = vi.fn(async () => {})
    render(<EntryLogger habit={labelHabit} onCreateEntry={onCreateEntry} />)

    await userEvent.click(screen.getByRole('button', { name: 'Good' }))
    await userEvent.click(screen.getByRole('button', { name: '✓ Good' }))
    expect(screen.getByRole('button', { name: 'Log' })).toBeDisabled()

    await userEvent.click(screen.getByRole('button', { name: 'Good' }))
    await userEvent.click(screen.getByRole('button', { name: 'Bad' }))
    await userEvent.click(screen.getByRole('button', { name: 'Clear choice' }))
    expect(screen.getByRole('button', { name: 'Log' })).toBeDisabled()
    expect(onCreateEntry).not.toHaveBeenCalled()
  })

  it('shows the error and keeps the choice when saving several labels fails', async () => {
    const onCreateEntries = vi.fn(async () => {
      throw new Error('Value must match one of the habit label options.')
    })
    render(
      <EntryLogger habit={labelHabit} onCreateEntry={vi.fn()} onCreateEntries={onCreateEntries} />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Good' }))
    await userEvent.click(screen.getByRole('button', { name: 'Bad' }))
    await userEvent.click(screen.getByRole('button', { name: 'Log 2 labels' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Value must match')
    expect(screen.getByRole('button', { name: 'Log 2 labels' })).toBeEnabled()
  })

  it('adds and removes labels from the logging panel', async () => {
    const onUpdateLabelOptions = vi.fn(async (_options: string[]) => {})
    render(
      <EntryLogger habit={labelHabit} onCreateEntry={vi.fn()} onUpdateLabelOptions={onUpdateLabelOptions} />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Add or remove labels' }))
    await userEvent.type(screen.getByLabelText('New label for Test habit'), ' Okay {Enter}')
    expect(onUpdateLabelOptions).toHaveBeenLastCalledWith(['Good', 'Bad', 'Okay'])
    expect(screen.getByLabelText('New label for Test habit')).toHaveValue('')

    await userEvent.click(screen.getByRole('button', { name: 'Remove label Bad' }))
    expect(onUpdateLabelOptions).toHaveBeenLastCalledWith(['Good'])
  })

  it('refuses a duplicate label without saving, and shows a refused removal', async () => {
    const onUpdateLabelOptions = vi.fn(async (options: string[]) => {
      if (!options.includes('Bad')) {
        throw new Error('Cannot remove or rename label options used by existing entries: Bad.')
      }
    })
    render(
      <EntryLogger habit={labelHabit} onCreateEntry={vi.fn()} onUpdateLabelOptions={onUpdateLabelOptions} />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Add or remove labels' }))
    await userEvent.type(screen.getByLabelText('New label for Test habit'), 'good{Enter}')
    expect(onUpdateLabelOptions).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('The label "Good" already exists.')

    await userEvent.click(screen.getByRole('button', { name: 'Remove label Bad' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('used by existing entries: Bad')
  })

  it('does not offer label editing without the update callback', () => {
    render(<EntryLogger habit={labelHabit} onCreateEntry={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Add or remove labels' })).not.toBeInTheDocument()
  })

  it('logs a number typed with a comma by pressing Enter, then clears the field', async () => {
    const onCreateEntry = vi.fn(async () => {})

    render(<EntryLogger habit={numberHabit} onCreateEntry={onCreateEntry} />)

    const input = screen.getByLabelText('Value for Water')
    await userEvent.type(input, '2,5{Enter}')

    expect(onCreateEntry).toHaveBeenCalledWith(expect.objectContaining({ value: 2.5 }))
    expect(await screen.findByRole('status')).toBeInTheDocument()
    expect(input).toHaveValue('')
  })

  it('shows an error and saves nothing for an invalid number', async () => {
    const onCreateEntry = vi.fn(async () => {})

    render(<EntryLogger habit={numberHabit} onCreateEntry={onCreateEntry} />)

    await userEvent.type(screen.getByLabelText('Value for Water'), 'abc')
    await userEvent.click(screen.getByRole('button', { name: 'Log' }))

    expect(onCreateEntry).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid number')
  })

  it('logs a text entry', async () => {
    const onCreateEntry = vi.fn(async () => {})

    render(<EntryLogger habit={textHabit} onCreateEntry={onCreateEntry} />)

    await userEvent.type(screen.getByLabelText('Text for Test habit'), 'Slept well')
    await userEvent.click(screen.getByRole('button', { name: 'Log' }))

    expect(onCreateEntry).toHaveBeenCalledWith(expect.objectContaining({ value: 'Slept well' }))
  })

  it('saves only once when clicked twice while saving', async () => {
    let finish: () => void = () => {}
    const onCreateEntry = vi.fn(
      () => new Promise<void>((resolve) => { finish = resolve }),
    )

    render(<EntryLogger habit={checkboxHabit} onCreateEntry={onCreateEntry} />)

    const done = screen.getByRole('button', { name: 'Done' })
    fireEvent.click(done)
    fireEvent.click(done)

    expect(onCreateEntry).toHaveBeenCalledOnce()

    finish()
    expect(await screen.findByRole('status')).toBeInTheDocument()
  })

  it('shows database errors next to the form', async () => {
    const onCreateEntry = vi.fn(async () => {
      throw new Error('Cannot log entries for an archived habit.')
    })

    render(<EntryLogger habit={checkboxHabit} onCreateEntry={onCreateEntry} />)

    await userEvent.click(screen.getByRole('button', { name: 'Done' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Cannot log entries for an archived habit.',
    )
  })

  it('uses the chosen date, time, timezone and comment from "More options"', async () => {
    const onCreateEntry = vi.fn(async () => {})

    render(<EntryLogger habit={checkboxHabit} onCreateEntry={onCreateEntry} />)

    await userEvent.click(screen.getByRole('button', { name: /More options/ }))

    const timezone = screen.getByLabelText('Timezone')
    await userEvent.clear(timezone)
    await userEvent.type(timezone, 'Asia/Tokyo')

    setDateTime('09/11/2026', '08:00')

    await userEvent.type(screen.getByLabelText('Comment (optional)'), 'Back-filled')
    await userEvent.click(screen.getByRole('button', { name: 'Done' }))

    expect(onCreateEntry).toHaveBeenCalledWith({
      habitId: 'h1',
      value: true,
      // 08:00 in Tokyo (UTC+9) = 23:00 UTC the day before
      occurredStart: '2026-11-08T23:00:00.000Z',
      timezone: 'Asia/Tokyo',
      comment: 'Next experiment: Back-filled',
    })
  })

  it('reports a non-existent daylight-saving time instead of saving it', async () => {
    const onCreateEntry = vi.fn(async () => {})

    render(<EntryLogger habit={checkboxHabit} onCreateEntry={onCreateEntry} />)

    await userEvent.click(screen.getByRole('button', { name: /More options/ }))

    const timezone = screen.getByLabelText('Timezone')
    await userEvent.clear(timezone)
    await userEvent.type(timezone, 'Europe/Paris')

    setDateTime('29/03/2026', '02:30')

    await userEvent.click(screen.getByRole('button', { name: 'Done' }))

    expect(onCreateEntry).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('This time does not exist')
  })

  describe('24-hour time field', () => {
    it('shows the current time in 24-hour format and keeps using "now" until edited', async () => {
      const onCreateEntry = vi.fn(async () => {})

      render(<EntryLogger habit={checkboxHabit} onCreateEntry={onCreateEntry} />)

      await userEvent.click(screen.getByRole('button', { name: /More options/ }))

      const timeField = screen.getByLabelText('Date and time: time (24-hour)') as HTMLInputElement
      expect(timeField.value).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/)
      expect(screen.getByText('Uses the current time when you save.')).toBeInTheDocument()

      const before = Date.now()
      await userEvent.click(screen.getByRole('button', { name: 'Done' }))

      const call = onCreateEntry.mock.calls[0] as unknown as [{ occurredStart: string }]
      expect(Date.parse(call[0].occurredStart)).toBeGreaterThanOrEqual(before - 1000)
    })

    it('accepts the French "14h30" notation', async () => {
      const onCreateEntry = vi.fn(async () => {})

      render(<EntryLogger habit={checkboxHabit} onCreateEntry={onCreateEntry} />)

      await userEvent.click(screen.getByRole('button', { name: /More options/ }))

      const timezone = screen.getByLabelText('Timezone')
      await userEvent.clear(timezone)
      await userEvent.type(timezone, 'Europe/Paris')

      setDateTime('09/11/2026', '14h30')
      await userEvent.click(screen.getByRole('button', { name: 'Done' }))

      // 14:30 in Paris (UTC+1 in November) = 13:30 UTC
      expect(onCreateEntry).toHaveBeenCalledWith(
        expect.objectContaining({ occurredStart: '2026-11-09T13:30:00.000Z' }),
      )
    })

    it('rejects a 12-hour time and saves nothing', async () => {
      const onCreateEntry = vi.fn(async () => {})

      render(<EntryLogger habit={checkboxHabit} onCreateEntry={onCreateEntry} />)

      await userEvent.click(screen.getByRole('button', { name: /More options/ }))
      setDateTime('09/11/2026', '2:30 PM')

      expect(screen.getByText('Use the 24-hour clock, for example 14:30.')).toBeInTheDocument()

      await userEvent.click(screen.getByRole('button', { name: 'Done' }))

      expect(onCreateEntry).not.toHaveBeenCalled()
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Enter a valid date (dd/mm/yyyy) and a 24-hour time, for example 14:30.',
      )
    })

    it('rejects a month-first (US) date and saves nothing', async () => {
      const onCreateEntry = vi.fn(async () => {})

      render(<EntryLogger habit={checkboxHabit} onCreateEntry={onCreateEntry} />)

      await userEvent.click(screen.getByRole('button', { name: /More options/ }))
      setDateTime('11/30/2026', '08:00')

      expect(screen.getByText('Use day/month/year, for example 09/11/2026.')).toBeInTheDocument()

      await userEvent.click(screen.getByRole('button', { name: 'Done' }))

      expect(onCreateEntry).not.toHaveBeenCalled()
      expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid date (dd/mm/yyyy)')
    })

    it('shows today in the date field as dd/mm/yyyy', async () => {
      render(<EntryLogger habit={checkboxHabit} onCreateEntry={vi.fn()} />)

      await userEvent.click(screen.getByRole('button', { name: /More options/ }))

      const dateField = screen.getByLabelText('Date and time: date (dd/mm/yyyy)') as HTMLInputElement
      expect(dateField.value).toMatch(/^\d{2}\/\d{2}\/\d{4}$/)
    })

    it('goes back to "now" with "Use the current time instead"', async () => {
      const onCreateEntry = vi.fn(async () => {})

      render(<EntryLogger habit={checkboxHabit} onCreateEntry={onCreateEntry} />)

      await userEvent.click(screen.getByRole('button', { name: /More options/ }))
      setDateTime('01/01/2020', '08:00')

      await userEvent.click(screen.getByRole('button', { name: 'Use the current time instead' }))
      await userEvent.click(screen.getByRole('button', { name: 'Done' }))

      const call = onCreateEntry.mock.calls[0] as unknown as [{ occurredStart: string }]
      expect(call[0].occurredStart.startsWith('2020')).toBe(false)
    })
  })

  describe('with the real database', () => {
    afterEach(async () => {
      db.close()
      await db.delete()
    })

    it('stores the entry in IndexedDB', async () => {
      await db.delete()
      await db.open()

      const habit = await createHabit({ name: 'Water', type: 'number', unit: 'ml' })

      render(<EntryLogger habit={habit} onCreateEntry={createEntry} />)

      await userEvent.type(screen.getByLabelText('Value for Water'), '750{Enter}')
      await screen.findByRole('status')

      const entries = await db.entries.toArray()

      expect(entries).toHaveLength(1)
      expect(entries[0]).toMatchObject({
        habitId: habit.id,
        habitType: 'number',
        value: 750,
        timezone: 'America/New_York',
        comment: null,
        source: 'manual',
      })
    })
  })
})
