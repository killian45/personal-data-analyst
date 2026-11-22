import { describe, expect, it } from 'vitest'

import type { Entry, Habit, SleepSession } from '../database/types'

import { screenTimeSample } from '../screenTime/testScreenTime'

import { locationSamples } from '../location/testLocation'

import { DEFAULT_LOG_CRITERIA, filterSortPage, toLocationLogRow, toLogRow, toScreenTimeLogRow, toSleepLogRow } from './logRows'
import type { LogCriteria, LogRow } from './logRows'

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
const gym: Habit = { ...HABIT, id: 'gym', name: 'Gym', type: 'checkbox', unit: null, labelOptions: null, archived: true }
const mood: Habit = { ...HABIT, id: 'mood', name: 'Mood', type: 'label', unit: null, labelOptions: ['Good', 'Bad'] }
const reading: Habit = { ...HABIT, id: 'reading', name: 'Reading', type: 'stopwatch', unit: null, labelOptions: null }

const ENTRY = { ...RECORD, source: 'manual' as const, externalId: null, comment: null, timezone: 'Europe/Paris' }

describe('toLogRow', () => {
  it('shows a number entry in its event timezone with its unit', () => {
    const entry: Entry = {
      ...ENTRY,
      id: 'e1',
      habitId: 'water',
      habitType: 'number',
      value: 2.5,
      occurredStart: '2026-11-09T13:30:00.000Z',
      occurredEnd: null,
      comment: 'Morning',
    }

    expect(toLogRow(entry, water, 'Europe/Paris')).toMatchObject({
      localDate: '2026-11-09',
      dateLabel: 'Mon 9 Nov 2026',
      timeLabel: '14:30',
      showTimezone: false,
      habitName: 'Water',
      typeLabel: 'Number',
      valueLabel: '2.5',
      sortValue: 2.5,
      unit: 'ml',
      sourceLabel: 'Manual',
      comment: 'Morning',
    })
  })

  it('shows the event timezone when it differs from the device', () => {
    const entry: Entry = {
      ...ENTRY,
      id: 'e1',
      habitId: 'water',
      habitType: 'number',
      value: 1,
      timezone: 'Asia/Tokyo',
      // 23:00 UTC = 08:00 the next day in Tokyo
      occurredStart: '2026-11-08T23:00:00.000Z',
      occurredEnd: null,
    }

    expect(toLogRow(entry, water, 'Europe/Paris')).toMatchObject({
      localDate: '2026-11-09',
      timeLabel: '08:00',
      showTimezone: true,
      timezone: 'Asia/Tokyo',
    })
  })

  it('shows an entry in a chosen display timezone and names where it was recorded', () => {
    const entry: Entry = {
      ...ENTRY,
      id: 'e1',
      habitId: 'water',
      habitType: 'number',
      value: 1,
      timezone: 'Asia/Tokyo',
      // 23:00 UTC = 08:00 next day in Tokyo, 00:00 next day in Paris
      occurredStart: '2026-11-08T23:00:00.000Z',
      occurredEnd: null,
    }

    expect(toLogRow(entry, water, 'Europe/Paris', 'Europe/Paris')).toMatchObject({
      localDate: '2026-11-09',
      timeLabel: '00:00',
      timezone: 'Asia/Tokyo',
      showTimezone: true,
    })

    // "device": shown in the device timezone (here New York, UTC−5 → 18:00 on the 8th)
    expect(toLogRow(entry, water, 'America/New_York', 'device')).toMatchObject({
      localDate: '2026-11-08',
      timeLabel: '18:00',
      showTimezone: true,
    })

    // Recorded in the display timezone itself: nothing extra to name.
    expect(toLogRow(entry, water, 'Europe/Paris', 'Asia/Tokyo').showTimezone).toBe(false)
  })

  it('describes checkbox values and archived habits', () => {
    const entry: Entry = {
      ...ENTRY,
      id: 'e1',
      habitId: 'gym',
      habitType: 'checkbox',
      value: false,
      occurredStart: '2026-11-09T13:30:00.000Z',
      occurredEnd: null,
    }

    expect(toLogRow(entry, gym, 'Europe/Paris')).toMatchObject({
      valueLabel: 'Not done',
      sortValue: 0,
      habitArchived: true,
      unit: '',
    })
  })

  it('shows label values and sorts them ignoring case', () => {
    const entry: Entry = {
      ...ENTRY,
      id: 'e1',
      habitId: 'mood',
      habitType: 'label',
      value: 'Good',
      occurredStart: '2026-11-09T13:30:00.000Z',
      occurredEnd: null,
    }

    expect(toLogRow(entry, mood, 'Europe/Paris')).toMatchObject({
      valueLabel: 'Good',
      sortValue: 'good',
      typeLabel: 'Label',
      unit: '',
    })
  })

  it('shows a stopwatch duration, its time range and its number of periods', () => {
    const entry: Entry = {
      ...ENTRY,
      id: 'e1',
      habitId: 'reading',
      habitType: 'stopwatch',
      // 23:30–00:35 Paris with a 15-minute pause = 50 minutes active
      occurredStart: '2026-11-08T22:30:00.000Z',
      occurredEnd: '2026-11-08T23:35:00.000Z',
      value: {
        segments: [
          { start: '2026-11-08T22:30:00.000Z', end: '2026-11-08T23:00:00.000Z' },
          { start: '2026-11-08T23:15:00.000Z', end: '2026-11-08T23:35:00.000Z' },
        ],
      },
    }

    expect(toLogRow(entry, reading, 'Europe/Paris')).toMatchObject({
      timeLabel: '23:30–00:35 (next day or later)',
      valueLabel: '50 min (2 periods)',
      sortValue: 50 * 60_000,
      typeLabel: 'Stopwatch',
    })
  })
})

describe('toSleepLogRow', () => {
  const session: SleepSession = {
    id: 's1',
    source: 'manual',
    externalId: null,
    sourceApp: null,
    dedupeKey: 'manual:s1',
    startUtc: '2026-11-08T22:30:00.000Z',
    endUtc: '2026-11-09T06:15:00.000Z',
    timezone: 'Europe/Paris',
    startOffsetMinutes: null,
    endOffsetMinutes: null,
    stages: [],
    reportedSleepMs: null,
    comment: 'Woke once',
    importedAt: null,
    metadata: null,
    syncStatus: 'pending',
    revision: 1,
    syncedRevision: null,
    createdAt: '2026-11-09T07:00:00.000Z',
    updatedAt: '2026-11-09T07:00:00.000Z',
    deletedAt: null,
  }

  it('shows a night as a Sleep row with its time in bed', () => {
    expect(toSleepLogRow(session, 'Europe/Paris')).toMatchObject({
      kind: 'sleep',
      localDate: '2026-11-08',
      dateLabel: 'Sun 8 Nov 2026',
      timeLabel: '23:30–07:15 (next day or later)',
      habitName: 'Sleep',
      habitType: 'sleep',
      typeLabel: 'Sleep',
      valueLabel: '7 h 45 min in bed',
      sortValue: 465 * 60_000,
      sourceLabel: 'Manual',
      comment: 'Woke once',
      showTimezone: false,
    })
  })

  it('uses the reported UTC offset when an imported session has no timezone name', () => {
    const imported = {
      ...session,
      source: 'health_connect' as const,
      timezone: null,
      startOffsetMinutes: -300,
    }

    // 22:30 UTC at −05:00 = 17:30
    expect(toSleepLogRow(imported, 'Europe/Paris')).toMatchObject({
      timeLabel: '17:30–01:15 (next day or later)',
      timezone: '-05:00',
      showTimezone: true,
      sourceLabel: 'Health Connect',
    })
  })

  it('follows the chosen display timezone', () => {
    expect(toSleepLogRow(session, 'Europe/Paris', 'Asia/Tokyo')).toMatchObject({
      localDate: '2026-11-09',
      timeLabel: '07:30–15:15',
      showTimezone: true,
    })
  })
})

function row(overrides: Partial<LogRow> & Pick<LogRow, 'id'>): LogRow {
  return {
    kind: 'entry',
    occurredStart: '2026-11-09T12:00:00.000Z',
    localDate: '2026-11-09',
    dateLabel: '',
    timeLabel: '',
    timezone: 'Europe/Paris',
    showTimezone: false,
    habitId: 'water',
    habitName: 'Water',
    habitArchived: false,
    habitType: 'number',
    typeLabel: 'Number',
    valueLabel: '1',
    sortValue: 1,
    unit: 'ml',
    sourceLabel: 'Manual',
    comment: '',
    ...overrides,
  }
}

const ROWS: LogRow[] = [
  row({ id: 'a', occurredStart: '2026-11-07T08:00:00.000Z', localDate: '2026-11-07', valueLabel: '500', sortValue: 500, comment: 'After run' }),
  row({ id: 'b', occurredStart: '2026-11-08T08:00:00.000Z', localDate: '2026-11-08', habitId: 'mood', habitName: 'Mood', habitType: 'label', typeLabel: 'Label', valueLabel: 'Good', sortValue: 'good', unit: '' }),
  row({ id: 'c', occurredStart: '2026-11-09T08:00:00.000Z', localDate: '2026-11-09', valueLabel: '250', sortValue: 250 }),
  row({ id: 'd', occurredStart: '2026-11-10T08:00:00.000Z', localDate: '2026-11-10', habitId: 'gym', habitName: 'Gym', habitType: 'checkbox', typeLabel: 'Checkbox', valueLabel: 'Done', sortValue: 1, unit: '' }),
]

function criteria(overrides: Partial<LogCriteria> = {}): LogCriteria {
  return { ...DEFAULT_LOG_CRITERIA, ...overrides }
}

const ids = (rows: LogRow[]) => rows.map((r) => r.id)

describe('filterSortPage', () => {
  it('shows newest first by default', () => {
    expect(ids(filterSortPage(ROWS, criteria()).rows)).toEqual(['d', 'c', 'b', 'a'])
  })

  it('searches habit names, values and comments, ignoring case', () => {
    expect(ids(filterSortPage(ROWS, criteria({ search: 'MOOD' })).rows)).toEqual(['b'])
    expect(ids(filterSortPage(ROWS, criteria({ search: '250' })).rows)).toEqual(['c'])
    expect(ids(filterSortPage(ROWS, criteria({ search: ' after ' })).rows)).toEqual(['a'])
  })

  it('filters sleep rows by type', () => {
    const rows = [...ROWS, row({ id: 's', kind: 'sleep', habitId: '__sleep__', habitName: 'Sleep', habitType: 'sleep', typeLabel: 'Sleep' })]

    expect(ids(filterSortPage(rows, criteria({ habitType: 'sleep' })).rows)).toEqual(['s'])
    expect(ids(filterSortPage(rows, criteria({ habitId: '__sleep__' })).rows)).toEqual(['s'])
  })

  it('filters by habit and by type', () => {
    expect(ids(filterSortPage(ROWS, criteria({ habitId: 'water' })).rows)).toEqual(['c', 'a'])
    expect(ids(filterSortPage(ROWS, criteria({ habitType: 'checkbox' })).rows)).toEqual(['d'])
  })

  it('filters by local date, inclusive at both ends', () => {
    expect(
      ids(filterSortPage(ROWS, criteria({ fromDate: '2026-11-08', toDate: '2026-11-09' })).rows),
    ).toEqual(['c', 'b'])
  })

  it('sorts by value with numbers before text, in both directions', () => {
    expect(ids(filterSortPage(ROWS, criteria({ sortColumn: 'value', sortDirection: 'asc' })).rows)).toEqual(['d', 'c', 'a', 'b'])
    expect(ids(filterSortPage(ROWS, criteria({ sortColumn: 'value', sortDirection: 'desc' })).rows)).toEqual(['b', 'a', 'c', 'd'])
  })

  it('sorts by habit name and breaks ties newest first', () => {
    expect(ids(filterSortPage(ROWS, criteria({ sortColumn: 'habit', sortDirection: 'asc' })).rows)).toEqual(['d', 'b', 'c', 'a'])
  })

  it('pages the results and reports the totals', () => {
    const first = filterSortPage(ROWS, criteria({ pageSize: 3 }))
    const second = filterSortPage(ROWS, criteria({ pageSize: 3, page: 2 }))

    expect(first).toMatchObject({ total: 4, page: 1, pageCount: 2 })
    expect(ids(first.rows)).toEqual(['d', 'c', 'b'])
    expect(ids(second.rows)).toEqual(['a'])
  })

  it('clamps a page number beyond the last page', () => {
    expect(filterSortPage(ROWS, criteria({ pageSize: 3, page: 9 })).page).toBe(2)
  })

  it('returns an empty first page when nothing matches', () => {
    expect(filterSortPage(ROWS, criteria({ search: 'nothing' }))).toEqual({
      rows: [],
      total: 0,
      page: 1,
      pageCount: 1,
    })
  })

  it('does not change the input rows', () => {
    const copy = ROWS.map((r) => ({ ...r }))
    filterSortPage(ROWS, criteria({ sortColumn: 'value', sortDirection: 'asc' }))
    expect(ROWS).toEqual(copy)
  })
})

describe('toScreenTimeLogRow', () => {
  it('shows the whole day with its total and number of apps', () => {
    expect(toScreenTimeLogRow(screenTimeSample('st-1'), 'Europe/Paris')).toMatchObject({
      id: 'st-1',
      kind: 'screen_time',
      occurredStart: '2026-11-08T23:00:00.000Z',
      localDate: '2026-11-09',
      dateLabel: 'Mon 9 Nov 2026',
      timeLabel: 'Whole day',
      timezone: 'Europe/Paris',
      showTimezone: false,
      habitId: '__screen_time__',
      habitName: 'Screen time',
      habitType: 'screen_time',
      typeLabel: 'Screen time',
      valueLabel: '1 h 13 min (2 apps)',
      sortValue: 4_380_000,
      sourceLabel: 'Import (App Usage)',
      comment: '',
    })
  })

  it('keeps its own calendar day in any display timezone, and names its timezone', () => {
    const row = toScreenTimeLogRow(screenTimeSample('st-1'), 'America/New_York', 'America/New_York')
    expect(row.localDate).toBe('2026-11-09')
    expect(row.dateLabel).toBe('Mon 9 Nov 2026')
    expect(row.showTimezone).toBe(true)
  })

  it('labels phone days simply "Phone"', () => {
    const sample = screenTimeSample('p', '2026-11-09', { source: 'android_usage', sourceApp: 'Android (Usage access)', dedupeKey: 'screen_time:android_usage:2026-11-09' })
    expect(toScreenTimeLogRow(sample, 'Europe/Paris').sourceLabel).toBe('Phone')
  })

  it('handles a day without a per-app list', () => {
    const sample = screenTimeSample('st-1', '2026-11-09', { value: 30 })
    const row = toScreenTimeLogRow({ ...sample, metadata: { ...sample.metadata, apps: null } }, 'Europe/Paris')
    expect(row.valueLabel).toBe('less than 1 min')
  })

  it('can be filtered by type and by its day', () => {
    const rows = [toScreenTimeLogRow(screenTimeSample('a', '2026-11-08'), 'Europe/Paris'), toScreenTimeLogRow(screenTimeSample('b', '2026-11-09'), 'Europe/Paris')]
    const page = filterSortPage(rows, { ...DEFAULT_LOG_CRITERIA, habitType: 'screen_time', fromDate: '2026-11-09', toDate: '2026-11-09' })
    expect(page.rows.map((row) => row.id)).toEqual(['b'])
  })
})

describe('toLocationLogRow', () => {
  const [visit, movement] = locationSamples()

  it('shows a visit with its place type, local times and duration', () => {
    expect(toLocationLogRow(visit, 'Europe/Paris')).toMatchObject({
      kind: 'location',
      localDate: '2026-11-09',
      dateLabel: 'Mon 9 Nov 2026',
      timeLabel: '08:00–12:00',
      timezone: '+01:00',
      showTimezone: false, // +01:00 is Paris's offset on that day
      habitId: '__location__',
      habitName: 'Location',
      habitType: 'location',
      typeLabel: 'Visit',
      valueLabel: 'Home · 4 h 00 min',
      sourceLabel: 'Import (Google Timeline)',
    })
  })

  it('shows a movement with activity, distance and duration; names the offset when it differs', () => {
    expect(toLocationLogRow(movement, 'America/New_York')).toMatchObject({
      typeLabel: 'Movement',
      valueLabel: 'Cycling · 3.2 km · 20 min',
      timeLabel: '12:00–12:20',
      showTimezone: true,
    })
  })

  it('can be filtered by the Location type', () => {
    const rows = [toLocationLogRow(visit, 'Europe/Paris'), toScreenTimeLogRow(locationSamples()[0], 'Europe/Paris')]
    expect(filterSortPage(rows, { ...DEFAULT_LOG_CRITERIA, habitType: 'location' }).rows.map((row) => row.id)).toEqual(['visit-1'])
  })
})
