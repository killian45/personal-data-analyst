import { commentTemplate } from '../logging/commentTemplate'
import { describe, expect, it } from 'vitest'

import type { Entry, Habit } from '../database/types'

import { buildEntryUpdate, hasPauses, initialEditForm } from './buildEntryUpdate'

const RECORD = {
  syncStatus: 'pending' as const,
  revision: 1,
  syncedRevision: null,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
  deletedAt: null,
}
const HABIT = { ...RECORD, color: '#2563eb', archived: false, sortOrder: 0 }

const water: Habit = { ...HABIT, id: 'water', name: 'Water', type: 'number', unit: 'ml', labelOptions: null, dailyAggregation: 'sum', target: null }
const mood: Habit = { ...HABIT, id: 'mood', name: 'Mood', type: 'label', unit: null, labelOptions: ['Good', 'Bad'] }
const reading: Habit = { ...HABIT, id: 'reading', name: 'Reading', type: 'stopwatch', unit: null, labelOptions: null }

const ENTRY = { ...RECORD, source: 'manual' as const, externalId: null, timezone: 'Europe/Paris' }

// 13:30:42.5 UTC = 14:30:42 in Paris. The seconds must survive edits.
const numberEntry: Entry = {
  ...ENTRY,
  id: 'n1',
  habitId: 'water',
  habitType: 'number',
  value: 500,
  occurredStart: '2026-11-09T13:30:42.500Z',
  occurredEnd: null,
  comment: 'Morning',
}

const labelEntry: Entry = {
  ...ENTRY,
  id: 'l1',
  habitId: 'mood',
  habitType: 'label',
  value: 'Good',
  occurredStart: '2026-11-09T13:30:00.000Z',
  occurredEnd: null,
  comment: null,
}

const singleSession: Entry = {
  ...ENTRY,
  id: 's1',
  habitId: 'reading',
  habitType: 'stopwatch',
  occurredStart: '2026-11-09T07:00:00.000Z',
  occurredEnd: '2026-11-09T08:05:00.000Z',
  value: { segments: [{ start: '2026-11-09T07:00:00.000Z', end: '2026-11-09T08:05:00.000Z' }] },
  comment: null,
}

const pausedSession: Entry = {
  ...singleSession,
  id: 's2',
  value: {
    segments: [
      { start: '2026-11-09T07:00:00.000Z', end: '2026-11-09T07:30:00.000Z' },
      { start: '2026-11-09T07:45:00.000Z', end: '2026-11-09T08:05:00.000Z' },
    ],
  },
}

describe('initialEditForm', () => {
  it('shows the entry in its own timezone as dd/mm/yyyy and 24-hour time', () => {
    expect(initialEditForm(numberEntry)).toEqual({
      rawValue: '500',
      date: '09/11/2026',
      time: '14:30',
      endDate: '',
      endTime: '',
      timezone: 'Europe/Paris',
      comment: 'Morning',
    })
  })

  it('includes the end of a stopwatch session', () => {
    expect(initialEditForm(singleSession)).toMatchObject({
      date: '09/11/2026',
      time: '08:00',
      endDate: '09/11/2026',
      endTime: '09:05',
    })
  })
})

describe('hasPauses', () => {
  it('is true only for stopwatch sessions with several periods', () => {
    expect(hasPauses(numberEntry)).toBe(false)
    expect(hasPauses(singleSession)).toBe(false)
    expect(hasPauses(pausedSession)).toBe(true)
  })
})

describe('buildEntryUpdate', () => {
  it('sends nothing when nothing changed', () => {
    expect(buildEntryUpdate(numberEntry, water, initialEditForm(numberEntry)).changes).toEqual({})
  })

  it('shows the comment prompts for an entry without comment, and saving them untouched changes nothing', () => {
    const form = initialEditForm(labelEntry)
    expect(form.comment).toBe(commentTemplate())
    expect(buildEntryUpdate(labelEntry, mood, form).changes).toEqual({})
  })

  it('saves only the filled prompts', () => {
    const { changes } = buildEntryUpdate(labelEntry, mood, {
      ...initialEditForm(labelEntry),
      comment: 'Why: good news\nIncreased: \nDecreased: \nNext experiment: ',
    })
    expect(changes).toEqual({ comment: 'Why: good news' })
  })

  it('changing only the comment keeps the exact original time (with seconds)', () => {
    const { changes } = buildEntryUpdate(numberEntry, water, {
      ...initialEditForm(numberEntry),
      comment: 'Corrected',
    })

    expect(changes).toEqual({ comment: 'Corrected' })
  })

  it('treats "14h30" as the same time as "14:30"', () => {
    const { changes } = buildEntryUpdate(numberEntry, water, {
      ...initialEditForm(numberEntry),
      time: '14h30',
    })

    expect(changes).toEqual({})
  })

  it('parses a changed number, accepting a comma', () => {
    const { changes } = buildEntryUpdate(numberEntry, water, {
      ...initialEditForm(numberEntry),
      rawValue: '750,5',
    })

    expect(changes).toEqual({ value: 750.5 })
  })

  it('rejects an invalid number', () => {
    expect(() =>
      buildEntryUpdate(numberEntry, water, { ...initialEditForm(numberEntry), rawValue: 'abc' }),
    ).toThrow('Enter a valid number')
  })

  it('converts a changed date and time from the entry timezone', () => {
    const { changes } = buildEntryUpdate(numberEntry, water, {
      ...initialEditForm(numberEntry),
      date: '08/11/2026',
      time: '07:15',
    })

    // 07:15 in Paris (UTC+1) = 06:15 UTC
    expect(changes).toEqual({ occurredStart: '2026-11-08T06:15:00.000Z' })
  })

  it('keeps the wall-clock time when the timezone changes', () => {
    const { changes } = buildEntryUpdate(labelEntry, mood, {
      ...initialEditForm(labelEntry),
      timezone: 'Asia/Tokyo',
    })

    // 14:30 in Tokyo (UTC+9) = 05:30 UTC
    expect(changes).toEqual({
      timezone: 'Asia/Tokyo',
      occurredStart: '2026-11-09T05:30:00.000Z',
    })
  })

  it('refuses a non-existent daylight-saving time and flags a repeated one', () => {
    expect(() =>
      buildEntryUpdate(labelEntry, mood, { ...initialEditForm(labelEntry), date: '29/03/2026', time: '02:30' }),
    ).toThrow('This time does not exist')

    const result = buildEntryUpdate(labelEntry, mood, {
      ...initialEditForm(labelEntry),
      date: '25/10/2026',
      time: '02:30',
    })

    expect(result.ambiguousTime).toBe(true)
  })

  it('rejects an invalid date', () => {
    expect(() =>
      buildEntryUpdate(labelEntry, mood, { ...initialEditForm(labelEntry), date: '31/02/2026' }),
    ).toThrow('Enter a valid date (dd/mm/yyyy)')
  })

  it('changes a label value', () => {
    expect(
      buildEntryUpdate(labelEntry, mood, { ...initialEditForm(labelEntry), rawValue: 'Bad' }).changes,
    ).toEqual({ value: 'Bad' })
  })

  describe('stopwatch sessions', () => {
    it('changes only the end of a session without pauses', () => {
      const { changes } = buildEntryUpdate(singleSession, reading, {
        ...initialEditForm(singleSession),
        endTime: '09:30',
      })

      expect(changes).toEqual({ occurredEnd: '2026-11-09T08:30:00.000Z' })
    })

    it('refuses an end before the start', () => {
      expect(() =>
        buildEntryUpdate(singleSession, reading, { ...initialEditForm(singleSession), endTime: '07:00' }),
      ).toThrow('The end must be after the start.')
    })

    it('names the start or end field in time errors', () => {
      expect(() =>
        buildEntryUpdate(singleSession, reading, { ...initialEditForm(singleSession), endTime: '9 PM' }),
      ).toThrow('End: Enter a valid date')
    })

    // pausedSession in Paris: 08:00–08:30, pause, 08:45–09:05.

    it('does not move a session with pauses when only the timezone changes', () => {
      const { changes } = buildEntryUpdate(pausedSession, reading, {
        ...initialEditForm(pausedSession),
        timezone: 'Asia/Tokyo',
        comment: 'Long read',
      })

      expect(changes).toEqual({ timezone: 'Asia/Tokyo', comment: 'Long read' })
    })

    it('moves only the first period start of a session with pauses', () => {
      const { changes } = buildEntryUpdate(pausedSession, reading, {
        ...initialEditForm(pausedSession),
        time: '07:50',
      })

      // 07:50 Paris = 06:50 UTC; the pause and second period are kept.
      expect(changes).toEqual({
        value: {
          segments: [
            { start: '2026-11-09T06:50:00.000Z', end: '2026-11-09T07:30:00.000Z' },
            { start: '2026-11-09T07:45:00.000Z', end: '2026-11-09T08:05:00.000Z' },
          ],
        },
      })
    })

    it('moves only the last period end of a session with pauses', () => {
      const { changes } = buildEntryUpdate(pausedSession, reading, {
        ...initialEditForm(pausedSession),
        endTime: '09:20',
      })

      expect(changes).toEqual({
        value: {
          segments: [
            { start: '2026-11-09T07:00:00.000Z', end: '2026-11-09T07:30:00.000Z' },
            { start: '2026-11-09T07:45:00.000Z', end: '2026-11-09T08:20:00.000Z' },
          ],
        },
      })
    })

    it('refuses a start after the first pause began', () => {
      expect(() =>
        buildEntryUpdate(pausedSession, reading, { ...initialEditForm(pausedSession), time: '08:40' }),
      ).toThrow('The start must be before the first pause, which began at 08:30.')
    })

    it('refuses an end before the last pause ended', () => {
      expect(() =>
        buildEntryUpdate(pausedSession, reading, { ...initialEditForm(pausedSession), endTime: '08:40' }),
      ).toThrow('The end must be after the last pause, which ended at 08:45.')
    })
  })
})
