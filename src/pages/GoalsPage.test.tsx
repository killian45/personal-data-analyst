import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { db } from '../database/db'
import { createEntry } from '../database/entries'
import { createHabit } from '../database/habits'
import { loadGoals, loadProfile } from '../goals/goalsStore'

import GoalsPage from './GoalsPage'

// Test timezone: America/New_York. "Today" = 10 Nov 2026.
const NOW = Date.parse('2026-11-10T17:00:00.000Z')

describe('GoalsPage', () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    await db.delete()
    await db.open()
  })

  afterEach(async () => {
    cleanup()
    vi.useRealTimers()
    db.close()
    await db.delete()
  })

  it('saves the AI set-up (every field optional)', async () => {
    const user = userEvent.setup()
    render(<GoalsPage />)
    await user.click(await screen.findByRole('button', { name: 'Set up AI' }))
    await user.click(screen.getByRole('button', { name: 'Add an epoch' }))
    await user.type(screen.getByLabelText('Epoch 1: name'), 'University')
    await user.type(screen.getByLabelText("AI's style"), 'Direct and challenging')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('AI set-up saved.')).toBeInTheDocument()
    expect(await loadProfile()).toMatchObject({ epochs: [{ title: 'University', text: '' }], aiStyle: 'Direct and challenging', virtues: '' })
  })

  it('adds a goal (every field required), shows its progress and data figure, edits and deletes it', async () => {
    const water = await createHabit({ name: 'Water', type: 'number', unit: 'ml' })
    // Before the goal: 1 of 2 days at 2000 ml or more. During: 2500 and 1500 ml.
    for (const [date, value] of [['2026-10-30', 2100], ['2026-10-31', 1000], ['2026-11-08', 2500], ['2026-11-09', 1500]] as const) {
      await createEntry({ habitId: water.id, value, occurredStart: `${date}T16:00:00.000Z`, timezone: 'America/New_York' })
    }
    const user = userEvent.setup()
    render(<GoalsPage />)
    await user.click(await screen.findByRole('button', { name: 'Add a goal' }))

    await user.type(screen.getByLabelText('What is the goal, specifically?'), 'Drink 2 litres a day')
    await user.click(screen.getByRole('button', { name: 'Add the goal' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Choose whether the goal is a process, an outcome or other.')

    await user.click(screen.getByRole('radio', { name: /Process/ }))
    await user.selectOptions(screen.getByLabelText('Measure for progress'), 'Water')
    await user.selectOptions(screen.getByLabelText('Measure for success'), 'Water')
    await user.selectOptions(screen.getByLabelText('Success means'), 'Average per day at least')
    await user.type(screen.getByLabelText('Target'), '2000')
    await user.selectOptions(screen.getByLabelText(/How ambitious/), '4')
    await user.click(screen.getByRole('button', { name: 'Add the goal' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Rate the realism from 1 to 10.')

    await user.selectOptions(screen.getByLabelText(/How realistic/), '8')
    const startDate = screen.getByLabelText('Start: date (dd/mm/yyyy)')
    await user.clear(startDate)
    await user.type(startDate, '08/11/2026')
    await user.clear(screen.getByLabelText('Start: time (24-hour)'))
    await user.type(screen.getByLabelText('Start: time (24-hour)'), '08:00')
    await user.type(screen.getByLabelText('Finish: date (dd/mm/yyyy)'), '21/11/2026')
    await user.type(screen.getByLabelText('Finish: time (24-hour)'), '20:00')
    await user.click(screen.getByRole('button', { name: 'Add the goal' }))

    expect(await screen.findByText('Goal added.')).toBeInTheDocument()
    const card = screen.getByRole('article', { name: 'Drink 2 litres a day' })
    expect(card).toHaveTextContent('Process · 08/11/2026 08:00 → 21/11/2026 20:00 (America/New_York)')
    expect(card).toHaveTextContent('Success: Water: average per day at least 2,000 ml')
    // (2500 + 1500) / 2 = 2000 → on track; 3 of 14 days elapsed, 2 with data.
    expect(card).toHaveTextContent('So far2,000 mlOn track')
    expect(card).toHaveTextContent('Days3 of 142 with data')
    expect(card).toHaveTextContent('Ambition 4/10 · realism 8/10')
    expect(card).toHaveTextContent('in the 90 days before the start, water was at least 2,000 ml on 50 % of days (2 days with data)')
    const [stored] = await loadGoals()
    expect(stored).toMatchObject({ kind: 'process', success: { rule: 'mean-at-least', target: 2000, share: null }, startUtc: '2026-11-08T13:00:00.000Z' })

    await user.click(within(card).getByRole('button', { name: 'Edit' }))
    await user.clear(screen.getByLabelText('Target'))
    await user.type(screen.getByLabelText('Target'), '2200')
    await user.click(screen.getByRole('button', { name: 'Save the goal' }))
    expect(await screen.findByText('Goal saved.')).toBeInTheDocument()
    expect(screen.getByRole('article', { name: 'Drink 2 litres a day' })).toHaveTextContent('Not on track yet')

    await user.click(within(screen.getByRole('article', { name: 'Drink 2 litres a day' })).getByRole('button', { name: 'Delete' }))
    await user.click(screen.getByRole('button', { name: 'Confirm delete' }))
    expect(await screen.findByText('Goal "Drink 2 litres a day" deleted.')).toBeInTheDocument()
    expect(await loadGoals()).toEqual([])
  })
})
