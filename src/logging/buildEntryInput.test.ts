import { describe, expect, it } from 'vitest'

import type { Habit } from '../database/types'

import { buildEntryInput, parseNumberInput } from './buildEntryInput'

const BASE = {
  id: 'h1',
  name: 'Test',
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

const numberHabit: Habit = { ...BASE, type: 'number', unit: 'ml', labelOptions: null, dailyAggregation: 'sum', target: null }
const checkboxHabit: Habit = { ...BASE, type: 'checkbox', unit: null, labelOptions: null }
const labelHabit: Habit = { ...BASE, type: 'label', unit: null, labelOptions: ['Good', 'Bad'] }
const textHabit: Habit = { ...BASE, type: 'text', unit: null, labelOptions: null }
const stopwatchHabit: Habit = { ...BASE, type: 'stopwatch', unit: null, labelOptions: null }

const NOW = new Date('2026-11-09T13:30:00.000Z')

function form(rawValue: string | boolean, overrides: Partial<Parameters<typeof buildEntryInput>[1]> = {}) {
  return {
    rawValue,
    localDateTime: null,
    timezone: 'Europe/Paris',
    comment: '',
    ...overrides,
  }
}

describe('parseNumberInput', () => {
  it('accepts dot and comma decimals, signs and surrounding spaces', () => {
    expect(parseNumberInput('2.5')).toBe(2.5)
    expect(parseNumberInput('2,5')).toBe(2.5)
    expect(parseNumberInput(' -3 ')).toBe(-3)
    expect(parseNumberInput('+4')).toBe(4)
    expect(parseNumberInput('.5')).toBe(0.5)
    expect(parseNumberInput('0')).toBe(0)
  })

  it('rejects empty input', () => {
    expect(() => parseNumberInput('  ')).toThrow('Enter a number.')
  })

  it('rejects text, exponents, thousands separators and multiple separators', () => {
    for (const raw of ['abc', '1e3', '1 000', '1.000,5', '2,5,1', 'Infinity', '--1']) {
      expect(() => parseNumberInput(raw)).toThrow('Enter a valid number')
    }
  })
})

describe('buildEntryInput', () => {
  it('uses the current moment when no date/time is chosen', () => {
    const { input, ambiguousTime } = buildEntryInput(numberHabit, form('500'), NOW)

    expect(input).toEqual({
      habitId: 'h1',
      value: 500,
      occurredStart: '2026-11-09T13:30:00.000Z',
      timezone: 'Europe/Paris',
      comment: '',
    })
    expect(ambiguousTime).toBe(false)
  })

  it('converts a chosen local date/time in the entry timezone to UTC', () => {
    // 08:00 in Tokyo (UTC+9) = 23:00 UTC the day before
    const { input } = buildEntryInput(
      numberHabit,
      form('1', { localDateTime: '2026-11-09T08:00', timezone: 'Asia/Tokyo' }),
      NOW,
    )

    expect(input.occurredStart).toBe('2026-11-08T23:00:00.000Z')
    expect(input.timezone).toBe('Asia/Tokyo')
  })

  it('flags a time that occurs twice when clocks go back', () => {
    const { input, ambiguousTime } = buildEntryInput(
      checkboxHabit,
      form(true, { localDateTime: '2026-10-25T02:30' }),
      NOW,
    )

    expect(input.occurredStart).toBe('2026-10-25T00:30:00.000Z')
    expect(ambiguousTime).toBe(true)
  })

  it('rejects a time that does not exist when clocks move forward', () => {
    expect(() =>
      buildEntryInput(checkboxHabit, form(true, { localDateTime: '2026-03-29T02:30' }), NOW),
    ).toThrow('This time does not exist in Europe/Paris')
  })

  it('passes checkbox, label and trimmed text values', () => {
    expect(buildEntryInput(checkboxHabit, form(false), NOW).input.value).toBe(false)
    expect(buildEntryInput(labelHabit, form('Bad'), NOW).input.value).toBe('Bad')
    expect(buildEntryInput(textHabit, form('  Felt rested  '), NOW).input.value).toBe(
      'Felt rested',
    )
  })

  it('rejects missing values with clear messages', () => {
    expect(() => buildEntryInput(numberHabit, form(''), NOW)).toThrow('Enter a number.')
    expect(() => buildEntryInput(checkboxHabit, form('yes'), NOW)).toThrow(
      'Choose Done or Not done.',
    )
    expect(() => buildEntryInput(labelHabit, form(''), NOW)).toThrow('Choose an option.')
    expect(() => buildEntryInput(textHabit, form('   '), NOW)).toThrow('Enter some text.')
  })

  it('refers stopwatch habits to the stopwatch controls', () => {
    expect(() => buildEntryInput(stopwatchHabit, form(''), NOW)).toThrow(
      'Use the stopwatch controls to log this habit.',
    )
  })

  it('removes empty comment prompts and trims the comment', () => {
    expect(buildEntryInput(numberHabit, form('1', { comment: ' note ' }), NOW).input.comment).toBe('note')
    expect(
      buildEntryInput(numberHabit, form('1', { comment: 'Why: tired\nIncreased: \nNext experiment: ' }), NOW)
        .input.comment,
    ).toBe('Why: tired')
  })
})
