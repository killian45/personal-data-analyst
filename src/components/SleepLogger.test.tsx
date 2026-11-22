import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SleepLogger } from './SleepLogger'

function setField(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

async function openAndFill(bed: [string, string], wake: [string, string]) {
  await userEvent.click(screen.getByRole('button', { name: 'Log sleep' }))

  const zone = screen.getByLabelText('Timezone')
  await userEvent.clear(zone)
  await userEvent.type(zone, 'Europe/Paris')

  setField('Bedtime: date (dd/mm/yyyy)', bed[0])
  setField('Bedtime: time (24-hour)', bed[1])
  setField('Wake time: date (dd/mm/yyyy)', wake[0])
  setField('Wake time: time (24-hour)', wake[1])
}

describe('SleepLogger', () => {
  afterEach(() => {
    cleanup()
  })

  it('pre-fills last night from 23:00 to 07:00', async () => {
    render(<SleepLogger onCreateSleep={vi.fn()} />)

    await userEvent.click(screen.getByRole('button', { name: 'Log sleep' }))

    expect(screen.getByLabelText('Bedtime: time (24-hour)')).toHaveValue('23:00')
    expect(screen.getByLabelText('Wake time: time (24-hour)')).toHaveValue('07:00')
    expect((screen.getByLabelText('Bedtime: date (dd/mm/yyyy)') as HTMLInputElement).value).toMatch(/^\d{2}\/\d{2}\/\d{4}$/)
    expect(screen.getByText('Time in bed: 8 h 00 min')).toBeInTheDocument()
  })

  it('saves a night and confirms it', async () => {
    const onCreateSleep = vi.fn(async () => {})

    render(<SleepLogger onCreateSleep={onCreateSleep} />)

    await openAndFill(['08/11/2026', '23:30'], ['09/11/2026', '07:15'])
    expect(screen.getByText('Time in bed: 7 h 45 min')).toBeInTheDocument()

    await userEvent.type(screen.getByLabelText('Comment (optional)'), 'Woke once')
    await userEvent.click(screen.getByRole('button', { name: 'Save sleep' }))

    expect(onCreateSleep).toHaveBeenCalledWith({
      startUtc: '2026-11-08T22:30:00.000Z',
      endUtc: '2026-11-09T06:15:00.000Z',
      timezone: 'Europe/Paris',
      comment: 'Next experiment: Woke once',
    })
    expect(await screen.findByRole('status')).toHaveTextContent('Saved: 8 Nov, 23:30 → 9 Nov, 07:15 (7 h 45 min in bed).')
  })

  it('refuses a wake time before the bedtime', async () => {
    const onCreateSleep = vi.fn(async () => {})

    render(<SleepLogger onCreateSleep={onCreateSleep} />)

    await openAndFill(['09/11/2026', '23:30'], ['09/11/2026', '07:15'])
    await userEvent.click(screen.getByRole('button', { name: 'Save sleep' }))

    expect(onCreateSleep).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('The wake time must be after the bedtime.')
  })

  it('warns, without blocking, about nights longer than 14 hours', async () => {
    const onCreateSleep = vi.fn(async () => {})

    render(<SleepLogger onCreateSleep={onCreateSleep} />)

    await openAndFill(['08/11/2026', '20:00'], ['09/11/2026', '12:00'])

    expect(screen.getByText('This is more than 14 hours. Check the dates.')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Save sleep' }))
    expect(onCreateSleep).toHaveBeenCalledOnce()
  })

  it('shows database errors such as duplicates', async () => {
    const onCreateSleep = vi.fn(async () => {
      throw new Error('A manual sleep session with the same bedtime and wake time already exists.')
    })

    render(<SleepLogger onCreateSleep={onCreateSleep} />)

    await openAndFill(['08/11/2026', '23:30'], ['09/11/2026', '07:15'])
    await userEvent.click(screen.getByRole('button', { name: 'Save sleep' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('same bedtime and wake time already exists')
  })
})
