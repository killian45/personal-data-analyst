import { describe, expect, it } from 'vitest'

import { numbersNotGiven, tidySummary } from './check'

const FACTS = ['Period: 01/11/2026 to 10/11/2026 (10 days).', 'Bedtime: on average 23:48 per night (10 nights), 22 min later.', 'Distance: 12.5 km.']

describe('numbersNotGiven', () => {
  it('accepts numbers from the facts, written differently ("05" = "5")', () => {
    expect(numbersNotGiven('From 1/11/2026 you went to bed at 23:48, 22 minutes later, and travelled 12.5 km on 10 days.', FACTS)).toEqual([])
  })

  it('lists numbers that were not given (e.g. a 12-hour time or an invented figure)', () => {
    expect(numbersNotGiven('You went to bed at 11:48 PM and slept 30 % better, about 12.5 km.', FACTS)).toEqual(['11:48', '30'])
    expect(numbersNotGiven('From 02/11/2026 at 9:05.', FACTS)).toEqual(['02/11/2026', '09:05'])
  })
})

describe('tidySummary', () => {
  it('removes an introduction line', () => {
    expect(tidySummary('Here is a summary of your statistics:\n\nYou slept well.')).toBe('You slept well.')
    expect(tidySummary('Okay, here’s your summary:\nYou slept.')).toBe('You slept.')
    expect(tidySummary('You slept well.')).toBe('You slept well.')
  })
})
