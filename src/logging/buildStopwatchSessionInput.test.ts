import { describe, expect, it } from 'vitest'

import type { Habit } from '../database/types'

import { buildStopwatchSessionInput } from './buildStopwatchSessionInput'

const BASE = {
  id: 'h1',
  name: 'Reading',
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

const stopwatchHabit: Habit = { ...BASE, type: 'stopwatch', unit: null, labelOptions: null }
const numberHabit: Habit = { ...BASE, type: 'number', unit: null, labelOptions: null, dailyAggregation: 'sum', target: null }

const HOUR = 3_600_000

function form(overrides: Partial<Parameters<typeof buildStopwatchSessionInput>[1]> = {}) {
  return {
    startDate: '09/11/2026',
    startTime: '08:00',
    endDate: '09/11/2026',
    endTime: '09:05',
    timezone: 'Europe/Paris',
    comment: '',
    ...overrides,
  }
}

describe('buildStopwatchSessionInput', () => {
  it('builds a single-period entry with UTC start and end', () => {
    const built = buildStopwatchSessionInput(stopwatchHabit, form({ comment: 'Novel' }))

    // 08:00 and 09:05 in Paris (UTC+1 in November)
    expect(built.input).toEqual({
      habitId: 'h1',
      value: null,
      occurredStart: '2026-11-09T07:00:00.000Z',
      occurredEnd: '2026-11-09T08:05:00.000Z',
      timezone: 'Europe/Paris',
      comment: 'Novel',
    })
    expect(built.durationMs).toBe(65 * 60_000)
    expect(built.ambiguousTime).toBe(false)
  })

  it('handles a session across midnight', () => {
    const built = buildStopwatchSessionInput(
      stopwatchHabit,
      form({ startDate: '08/11/2026', startTime: '23:30', endDate: '09/11/2026', endTime: '00:15' }),
    )

    expect(built.durationMs).toBe(45 * 60_000)
  })

  it('measures actual time across the night clocks go back', () => {
    const built = buildStopwatchSessionInput(
      stopwatchHabit,
      form({ startDate: '24/10/2026', startTime: '23:00', endDate: '25/10/2026', endTime: '07:00' }),
    )

    // Clock difference 8 h, actual elapsed time 9 h.
    expect(built.durationMs).toBe(9 * HOUR)
  })

  it('flags a start or end time that occurs twice', () => {
    const built = buildStopwatchSessionInput(
      stopwatchHabit,
      form({ startDate: '25/10/2026', startTime: '02:30', endDate: '25/10/2026', endTime: '04:00' }),
    )

    expect(built.ambiguousTime).toBe(true)
  })

  it('rejects an end before or equal to the start', () => {
    expect(() =>
      buildStopwatchSessionInput(stopwatchHabit, form({ endTime: '07:59' })),
    ).toThrow('The end must be after the start.')

    expect(() =>
      buildStopwatchSessionInput(stopwatchHabit, form({ endTime: '08:00' })),
    ).toThrow('The end must be after the start.')
  })

  it('reports which field is invalid', () => {
    expect(() =>
      buildStopwatchSessionInput(stopwatchHabit, form({ startTime: '8 PM' })),
    ).toThrow('Enter a valid start date (dd/mm/yyyy) and a 24-hour time')

    expect(() =>
      buildStopwatchSessionInput(stopwatchHabit, form({ endDate: '' })),
    ).toThrow('Enter a valid end date (dd/mm/yyyy) and a 24-hour time')
  })

  it('reports a non-existent daylight-saving time with the field name', () => {
    expect(() =>
      buildStopwatchSessionInput(
        stopwatchHabit,
        form({ startDate: '29/03/2026', startTime: '02:30', endDate: '29/03/2026', endTime: '04:00' }),
      ),
    ).toThrow('Start: This time does not exist in Europe/Paris')
  })

  it('rejects an invalid timezone', () => {
    expect(() =>
      buildStopwatchSessionInput(stopwatchHabit, form({ timezone: 'Mars/Olympus' })),
    ).toThrow('Start: Invalid IANA timezone.')
  })

  it('only accepts stopwatch habits', () => {
    expect(() => buildStopwatchSessionInput(numberHabit, form())).toThrow(
      'Only stopwatch habits can log sessions.',
    )
  })
})
