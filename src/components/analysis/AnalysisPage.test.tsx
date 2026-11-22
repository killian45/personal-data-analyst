import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { db } from '../../database/db'
import { createEntry } from '../../database/entries'
import { createHabit } from '../../database/habits'
import { addDays } from '../../stats/subjects'

import AnalysisPage from './AnalysisPage'

/** 20 days of two made-up habits that rise and fall together (plus noise). */
async function seed(days = 20) {
  const coffee = await createHabit({ name: 'Coffee', type: 'number', unit: 'cups' })
  const steps = await createHabit({ name: 'Steps', type: 'number' })
  const cups = [1, 3, 2, 4, 1, 2, 5, 3, 2, 4, 1, 3, 2, 5, 4, 1, 2, 3, 4, 2]
  const noise = [1, -1, 2, 0, -2, 1, 0, -1, 2, 1, 0, -2, 1, 0, -1, 2, 0, 1, -1, 0]
  for (let i = 0; i < days; i += 1) {
    const date = addDays('2026-10-01', i)
    await createEntry({ habitId: coffee.id, value: cups[i], occurredStart: `${date}T08:00:00.000Z`, timezone: 'Europe/Paris' })
    await createEntry({ habitId: steps.id, value: 1000 * cups[i] + 300 * noise[i], occurredStart: `${date}T18:00:00.000Z`, timezone: 'Europe/Paris' })
  }
}

describe('AnalysisPage', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(async () => {
    cleanup()
    db.close()
    await db.delete()
  })

  it('needs two measures with data', async () => {
    render(<AnalysisPage />)
    expect(await screen.findByText(/At least two measures with data are needed/)).toBeInTheDocument()
  })

  it('compares two measures: reading, coefficients, days, data table, warnings and delay profile', async () => {
    await seed()
    render(<AnalysisPage />)

    const result = await screen.findByRole('region', { name: 'Coffee and Steps' })
    expect(within(result).getByText(/^On days when Coffee is higher, Steps \(the same day\) tends to be higher — a strong relation/)).toBeInTheDocument()
    expect(within(result).getByRole('rowheader', { name: 'Pearson r (straight-line)' })).toBeInTheDocument()
    expect(within(result).getByText(/^Based on 20 days with both values/)).toBeInTheDocument()
    expect(within(result).getByText('Show data (20 days)')).toBeInTheDocument()
    expect(within(result).getByText(/does not show that one causes the other/)).toBeInTheDocument()
    expect(within(result).getByText(/^Small sample: 20 days/)).toBeInTheDocument()

    const profile = screen.getByRole('region', { name: 'Delay profile' })
    const rows = within(profile).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(8)
    expect(rows[0]).toHaveTextContent('Same day (shown above)')
    expect(within(profile).getByText(/Benjamini–Hochberg, \d+ comparisons/)).toBeInTheDocument()
  })

  it('changes the delay and the measures, and refuses comparing a measure with itself on the same day', async () => {
    await seed()
    render(<AnalysisPage />)
    await screen.findByRole('region', { name: 'Coffee and Steps' })

    await userEvent.selectOptions(screen.getByLabelText('Y measured'), '1')
    expect(await screen.findByText(/Steps \(the next day\)/)).toBeInTheDocument()
    expect(screen.getByText('1 day later (shown above)')).toBeInTheDocument()

    await userEvent.selectOptions(screen.getByLabelText('Y measured'), '0')
    await userEvent.selectOptions(screen.getByLabelText('Measure Y'), 'Coffee')
    expect(await screen.findByText(/Choose two different measures/)).toBeInTheDocument()
  })

  it('explains too few days and an invalid custom range', async () => {
    await seed(8)
    render(<AnalysisPage />)
    expect(await screen.findByText(/^Only 8 days have both values \(at least 10 are needed\)/)).toBeInTheDocument()

    await userEvent.selectOptions(screen.getByLabelText('Days of X'), 'custom')
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a start and end date (dd/mm/yyyy).')
  })

  it('overview: compares every ticked pair, strongest first, and opens a pair in the detailed view', async () => {
    await seed()
    const water = await createHabit({ name: 'Water', type: 'number' })
    const glasses = [3, 1, 4, 1, 5, 2, 2, 6, 5, 3, 5, 2, 4, 6, 2, 6, 4, 3, 3, 2]
    for (let i = 0; i < 20; i += 1) {
      await createEntry({ habitId: water.id, value: glasses[i], occurredStart: `${addDays('2026-10-01', i)}T12:00:00.000Z`, timezone: 'Europe/Paris' })
    }
    render(<AnalysisPage />)
    const overview = await screen.findByRole('region', { name: 'Overview of many pairs' })
    expect(within(overview).getByText('Tick at least two measures.')).toBeInTheDocument()

    for (const name of ['Coffee', 'Steps', 'Water']) await userEvent.click(within(overview).getByRole('checkbox', { name }))

    expect(within(overview).getByText(/^3 measures → 3 pairs; 3 with enough data were compared/)).toBeInTheDocument()
    const rows = within(overview).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(3)
    expect(rows[0]).toHaveTextContent('Coffee — Steps') // strongest
    expect(rows[0]).toHaveTextContent('strong')

    await userEvent.click(within(overview).getByRole('button', { name: 'Open Steps and Water' }))
    expect(await screen.findByRole('region', { name: 'Steps and Water' })).toBeInTheDocument()
    expect(screen.getByLabelText('Y measured')).toHaveValue('0')
  })
})
