import { describe, expect, it } from 'vitest'

import type { Habit } from './types'
import {
  isHabitType,
  MAX_COMMENT_LENGTH,
  MAX_STOPWATCH_SEGMENTS,
  MAX_TEXT_LENGTH,
  normalizeComment,
  normalizeTimestamp,
  validateEntryTimes,
  validateEntryValue,
  validateHabitDefinition,
  validateStopwatchValue,
  validateTimezone,
} from './validation'

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

describe('isHabitType', () => {
  it('accepts the five supported types', () => {
    for (const type of ['stopwatch', 'number', 'checkbox', 'label', 'text']) {
      expect(isHabitType(type)).toBe(true)
    }
  })

  it('rejects anything else', () => {
    for (const value of ['Number', 'duration', '', null, undefined, 1]) {
      expect(isHabitType(value)).toBe(false)
    }
  })
})

describe('validateHabitDefinition', () => {
  it('keeps a trimmed unit for number habits', () => {
    expect(
      validateHabitDefinition({ name: ' Water ', type: 'number', unit: ' ml ' }),
    ).toEqual({
      name: 'Water',
      type: 'number',
      unit: 'ml',
      labelOptions: null,
      color: '#2563eb',
      dailyAggregation: 'sum',
      target: null,
    })
  })

  it('accepts a daily average and a target for number habits', () => {
    expect(
      validateHabitDefinition({ name: 'Weight', type: 'number', dailyAggregation: 'mean', target: 72.5 }),
    ).toMatchObject({ dailyAggregation: 'mean', target: 72.5 })
  })

  it('rejects an unknown daily aggregation or a non-numeric target', () => {
    expect(() =>
      validateHabitDefinition({ name: 'X', type: 'number', dailyAggregation: 'max' as never }),
    ).toThrow('Daily value must be "total" or "average".')
    expect(() =>
      validateHabitDefinition({ name: 'X', type: 'number', target: Number.NaN }),
    ).toThrow('The target must be a number.')
  })

  it('gives other habit types no daily aggregation or target', () => {
    const definition = validateHabitDefinition({ name: 'X', type: 'checkbox', dailyAggregation: 'mean', target: 3 })

    expect(definition).not.toHaveProperty('dailyAggregation')
    expect(definition).not.toHaveProperty('target')
  })

  it('stores null instead of a unit for non-number habits', () => {
    for (const type of ['stopwatch', 'checkbox', 'text'] as const) {
      expect(
        validateHabitDefinition({ name: 'X', type, unit: 'ml' }).unit,
      ).toBeNull()
    }

    expect(
      validateHabitDefinition({
        name: 'X',
        type: 'label',
        unit: 'ml',
        labelOptions: ['A'],
      }).unit,
    ).toBeNull()
  })

  it('stores null instead of label options for non-label habits', () => {
    expect(
      validateHabitDefinition({
        name: 'X',
        type: 'number',
        labelOptions: ['A', 'B'],
      }).labelOptions,
    ).toBeNull()
  })

  it('trims label options', () => {
    expect(
      validateHabitDefinition({
        name: 'Mood',
        type: 'label',
        labelOptions: [' Good ', 'Bad'],
      }).labelOptions,
    ).toEqual(['Good', 'Bad'])
  })

  it('accepts names of exactly 80 characters and rejects 81', () => {
    expect(
      validateHabitDefinition({ name: 'a'.repeat(80), type: 'text' }).name,
    ).toHaveLength(80)

    expect(() =>
      validateHabitDefinition({ name: 'a'.repeat(81), type: 'text' }),
    ).toThrow('Habit name cannot exceed 80 characters.')
  })

  it('rejects a unit longer than 20 characters on number habits', () => {
    expect(() =>
      validateHabitDefinition({ name: 'X', type: 'number', unit: 'u'.repeat(21) }),
    ).toThrow('Unit cannot exceed 20 characters.')
  })

  it('rejects an unknown type', () => {
    expect(() =>
      validateHabitDefinition({
        name: 'X',
        type: 'duration' as never,
      }),
    ).toThrow('Invalid habit type.')
  })

  it('rejects label options that differ only by case', () => {
    expect(() =>
      validateHabitDefinition({
        name: 'Mood',
        type: 'label',
        labelOptions: ['Good', 'good'],
      }),
    ).toThrow('Label options must be unique.')
  })

  it('rejects non-text label options', () => {
    expect(() =>
      validateHabitDefinition({
        name: 'Mood',
        type: 'label',
        labelOptions: ['Good', 3 as never],
      }),
    ).toThrow('Label options must be text.')
  })

  it('rejects a non-text name', () => {
    expect(() =>
      validateHabitDefinition({ name: 42 as never, type: 'text' }),
    ).toThrow('Habit name must be text.')
  })
})

describe('normalizeTimestamp', () => {
  it('converts an offset timestamp to UTC', () => {
    expect(normalizeTimestamp('2026-11-01T11:00:00+01:00')).toBe(
      '2026-11-01T10:00:00.000Z',
    )
  })

  it('keeps a UTC timestamp unchanged', () => {
    expect(normalizeTimestamp('2026-11-01T10:00:00.000Z')).toBe(
      '2026-11-01T10:00:00.000Z',
    )
  })

  it('rejects timestamps without a timezone offset', () => {
    expect(() => normalizeTimestamp('2026-11-01T10:00:00')).toThrow(
      'Timestamp must be an ISO 8601 date-time with a timezone.',
    )
  })

  it('rejects timestamps without seconds', () => {
    expect(() => normalizeTimestamp('2026-11-01T10:00Z')).toThrow(
      'Timestamp must be an ISO 8601 date-time with a timezone.',
    )
  })

  it('rejects impossible dates', () => {
    expect(() => normalizeTimestamp('2026-13-45T10:00:00Z')).toThrow()
  })
})

describe('validateTimezone', () => {
  it('accepts IANA timezones', () => {
    expect(validateTimezone('Europe/Paris')).toBe('Europe/Paris')
    expect(validateTimezone('Asia/Tokyo')).toBe('Asia/Tokyo')
  })

  it('rejects unknown and empty timezones', () => {
    expect(() => validateTimezone('Mars/Olympus')).toThrow('Invalid IANA timezone.')
    expect(() => validateTimezone('  ')).toThrow('Timezone cannot be empty.')
  })
})

describe('normalizeComment', () => {
  it('trims comments and turns empty comments into null', () => {
    expect(normalizeComment('  note  ')).toBe('note')
    expect(normalizeComment('   ')).toBeNull()
    expect(normalizeComment(undefined)).toBeNull()
    expect(normalizeComment(null)).toBeNull()
  })

  it('accepts the maximum length and rejects one more character', () => {
    expect(normalizeComment('c'.repeat(MAX_COMMENT_LENGTH))).toHaveLength(
      MAX_COMMENT_LENGTH,
    )
    expect(() => normalizeComment('c'.repeat(MAX_COMMENT_LENGTH + 1))).toThrow(
      'Comment cannot exceed 2000 characters.',
    )
  })
})

describe('validateEntryValue', () => {
  it('accepts finite numbers, including zero and negatives', () => {
    expect(validateEntryValue(numberHabit, 0)).toBe(0)
    expect(validateEntryValue(numberHabit, -2.5)).toBe(-2.5)
  })

  it('rejects NaN, Infinity and numeric text for number habits', () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, '5', null]) {
      expect(() => validateEntryValue(numberHabit, value)).toThrow(
        'Number habits require a finite numeric value.',
      )
    }
  })

  it('accepts only booleans for checkbox habits', () => {
    expect(validateEntryValue(checkboxHabit, false)).toBe(false)
    expect(() => validateEntryValue(checkboxHabit, 1)).toThrow(
      'Checkbox habits require a boolean value.',
    )
  })

  it('accepts only exact label options', () => {
    expect(validateEntryValue(labelHabit, 'Good')).toBe('Good')
    expect(() => validateEntryValue(labelHabit, 'good')).toThrow(
      'Value must match one of the habit label options.',
    )
  })

  it('accepts text up to the maximum length', () => {
    expect(validateEntryValue(textHabit, 't'.repeat(MAX_TEXT_LENGTH))).toHaveLength(
      MAX_TEXT_LENGTH,
    )
    expect(() => validateEntryValue(textHabit, 't'.repeat(MAX_TEXT_LENGTH + 1))).toThrow(
      'Text cannot exceed 10000 characters.',
    )
  })

  it('requires active periods for stopwatch entries', () => {
    const value = {
      segments: [{ start: '2026-11-01T10:00:00Z', end: '2026-11-01T11:00:00Z' }],
    }

    expect(validateEntryValue(stopwatchHabit, value)).toEqual({
      segments: [{ start: '2026-11-01T10:00:00.000Z', end: '2026-11-01T11:00:00.000Z' }],
    })

    for (const invalid of [null, 60, {}, { segments: 'x' }]) {
      expect(() => validateEntryValue(stopwatchHabit, invalid)).toThrow(
        'Stopwatch entries require a list of active periods.',
      )
    }
  })
})

describe('validateEntryTimes', () => {
  const start = '2026-11-01T10:00:00.000Z'
  const end = '2026-11-01T11:00:00.000Z'

  it('requires an end after the start for stopwatch entries', () => {
    expect(() => validateEntryTimes('stopwatch', start, end)).not.toThrow()
    expect(() => validateEntryTimes('stopwatch', start, null)).toThrow(
      'Stopwatch entries require an end timestamp.',
    )
    expect(() => validateEntryTimes('stopwatch', start, start)).toThrow(
      'Stopwatch end time must be after start time.',
    )
  })

  it('rejects an end timestamp for non-stopwatch entries', () => {
    expect(() => validateEntryTimes('number', start, null)).not.toThrow()
    expect(() => validateEntryTimes('number', start, end)).toThrow(
      'Only stopwatch entries can have an end timestamp.',
    )
  })
})

describe('validateStopwatchValue', () => {
  const p = (start: string, end: string) => ({ start, end })

  it('accepts several periods with pauses between them', () => {
    const value = {
      segments: [
        p('2026-11-01T10:00:00Z', '2026-11-01T10:10:00Z'),
        p('2026-11-01T10:15:00Z', '2026-11-01T10:35:00Z'),
      ],
    }

    expect(validateStopwatchValue(value).segments).toHaveLength(2)
  })

  it('converts period timestamps to UTC', () => {
    expect(
      validateStopwatchValue({
        segments: [p('2026-11-01T11:00:00+01:00', '2026-11-01T12:00:00+01:00')],
      }),
    ).toEqual({
      segments: [p('2026-11-01T10:00:00.000Z', '2026-11-01T11:00:00.000Z')],
    })
  })

  it('accepts a period starting exactly when the previous one ended', () => {
    expect(() =>
      validateStopwatchValue({
        segments: [
          p('2026-11-01T10:00:00Z', '2026-11-01T10:10:00Z'),
          p('2026-11-01T10:10:00Z', '2026-11-01T10:20:00Z'),
        ],
      }),
    ).not.toThrow()
  })

  it('rejects overlapping periods', () => {
    expect(() =>
      validateStopwatchValue({
        segments: [
          p('2026-11-01T10:00:00Z', '2026-11-01T10:10:00Z'),
          p('2026-11-01T10:09:59Z', '2026-11-01T10:20:00Z'),
        ],
      }),
    ).toThrow('Stopwatch periods must be in time order and must not overlap.')
  })

  it('rejects periods out of order', () => {
    expect(() =>
      validateStopwatchValue({
        segments: [
          p('2026-11-01T11:00:00Z', '2026-11-01T11:10:00Z'),
          p('2026-11-01T10:00:00Z', '2026-11-01T10:10:00Z'),
        ],
      }),
    ).toThrow('Stopwatch periods must be in time order and must not overlap.')
  })

  it('rejects zero-length and backwards periods', () => {
    for (const segment of [
      p('2026-11-01T10:00:00Z', '2026-11-01T10:00:00Z'),
      p('2026-11-01T10:00:00Z', '2026-11-01T09:00:00Z'),
    ]) {
      expect(() => validateStopwatchValue({ segments: [segment] })).toThrow(
        'Stopwatch end time must be after start time.',
      )
    }
  })

  it('rejects an empty list, malformed periods and invalid timestamps', () => {
    expect(() => validateStopwatchValue({ segments: [] })).toThrow(
      'Stopwatch entries require at least one active period.',
    )
    expect(() => validateStopwatchValue({ segments: [{ start: '2026-11-01T10:00:00Z' }] })).toThrow(
      'Each stopwatch period needs a start and an end.',
    )
    expect(() => validateStopwatchValue({ segments: [null] })).toThrow(
      'Each stopwatch period needs a start and an end.',
    )
    expect(() =>
      validateStopwatchValue({ segments: [p('2026-11-01T10:00:00', '2026-11-01T11:00:00Z')] }),
    ).toThrow('Timestamp must be an ISO 8601 date-time with a timezone.')
  })

  it('accepts 1,000 periods and rejects 1,001', () => {
    const make = (count: number) => ({
      segments: Array.from({ length: count }, (_, index) => {
        const start = Date.UTC(2026, 0, 1) + index * 120_000
        return p(new Date(start).toISOString(), new Date(start + 60_000).toISOString())
      }),
    })

    expect(validateStopwatchValue(make(MAX_STOPWATCH_SEGMENTS)).segments).toHaveLength(1000)
    expect(() => validateStopwatchValue(make(MAX_STOPWATCH_SEGMENTS + 1))).toThrow(
      'Stopwatch entries cannot have more than 1000 periods.',
    )
  })
})

describe('validateEntryTimes with stopwatch periods', () => {
  const value = {
    segments: [
      { start: '2026-11-01T10:00:00.000Z', end: '2026-11-01T10:10:00.000Z' },
      { start: '2026-11-01T10:15:00.000Z', end: '2026-11-01T10:35:00.000Z' },
    ],
  }

  it('accepts start/end equal to the first start and last end', () => {
    expect(() =>
      validateEntryTimes('stopwatch', '2026-11-01T10:00:00.000Z', '2026-11-01T10:35:00.000Z', value),
    ).not.toThrow()
  })

  it('rejects start/end that do not match the periods', () => {
    expect(() =>
      validateEntryTimes('stopwatch', '2026-11-01T10:00:00.000Z', '2026-11-01T10:10:00.000Z', value),
    ).toThrow('Stopwatch start and end must match its first and last periods.')
  })
})
