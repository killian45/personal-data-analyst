import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { db } from '../database/db'
import { createEntry, deleteEntry } from '../database/entries'
import { createHabit, setHabitArchived } from '../database/habits'
import { createManualSleepSession } from '../database/sleepSessions'
import type { Entry, ExternalSample, Habit } from '../database/types'
import { HEALTH_MEASUREMENT_TYPES } from '../healthData/healthData'
import { LOCATION_MOVEMENT, LOCATION_VISIT } from '../location/location'
import { SCREEN_TIME_DAILY } from '../screenTime/screenTime'
import { saveChosenApps } from '../settings/dashboardScreenTimeApps'
import { saveChosenCategories } from '../settings/dashboardYnabCategories'
import { saveSectionMetrics, loadMetricSelection, metricsForSection, parseMetricSelection } from '../settings/dashboardMetrics'
import { saveSleepTargets } from '../settings/sleepTargets'
import { YNAB_MEASUREMENT } from '../ynab/ynabRecord'
import { processSleep } from '../sleep/engine/processSleep'

import { formatChange, formatSpread, formatValue } from './format'
import { loadDashboardData } from './loadDashboardData'
import { habitDailyObservations, habitTextValues, sleepObservations } from './observations'
import { aggregate, enumerateDates, periodStart, presetRange, aggregateMany, shiftRange, smallStep, swipeMove } from './periods'
import { buildSectionStats } from './sectionStats'

const RECORD = {
  syncStatus: 'pending' as const,
  revision: 1,
  syncedRevision: null,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
  deletedAt: null,
}
const HABIT = { ...RECORD, color: '#2563eb', archived: false, sortOrder: 0 }

describe('periods', () => {
  it('builds preset ranges ending today', () => {
    expect(presetRange('7d', '2026-11-10')).toEqual({ start: '2026-11-04', end: '2026-11-10' })
    expect(presetRange('30d', '2026-11-10')).toEqual({ start: '2026-10-12', end: '2026-11-10' })
    expect(presetRange('90d', '2026-11-10').start).toBe('2026-08-13')
  })

  it('enumerates dates and finds period starts (weeks start on Monday)', () => {
    expect(enumerateDates({ start: '2026-10-30', end: '2026-11-02' })).toEqual([
      '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02',
    ])
    // 10 November 2026 is a Tuesday; 15 November a Sunday.
    expect(periodStart('2026-11-10', 'week')).toBe('2026-11-09')
    expect(periodStart('2026-11-15', 'week')).toBe('2026-11-09')
    expect(periodStart('2026-11-16', 'week')).toBe('2026-11-16')
    expect(periodStart('2026-11-10', 'month')).toBe('2026-11-01')
    expect(periodStart('2026-11-10', 'day')).toBe('2026-11-10')
  })

  it('averages daily values per period, keeps empty periods and skips missing days', () => {
    const range = { start: '2026-11-02', end: '2026-11-15' } // Mon 2 → Sun 15: two weeks
    const daily = [
      { date: '2026-11-02', value: 6 },
      { date: '2026-11-03', value: 8 },
      { date: '2026-11-04', value: null },
      { date: '2026-11-20', value: 100 }, // outside the range
    ]

    expect(aggregate(daily, range, 'week')).toEqual([
      { period: '2026-11-02', value: 7, n: 2 },
      { period: '2026-11-09', value: null, n: 0 },
    ])
    expect(aggregate(daily, range, 'day')).toHaveLength(14)
    expect(aggregate(daily, range, 'month')).toEqual([{ period: '2026-11-01', value: 7, n: 2 }])
  })
})

describe('observations', () => {
  const water: Habit = { ...HABIT, id: 'water', name: 'Water', type: 'number', unit: 'ml', labelOptions: null, dailyAggregation: 'sum', target: null }
  const weight: Habit = { ...water, id: 'weight', name: 'Weight', dailyAggregation: 'mean' }
  const gym: Habit = { ...HABIT, id: 'gym', name: 'Gym', type: 'checkbox', unit: null, labelOptions: null }
  const reading: Habit = { ...HABIT, id: 'reading', name: 'Reading', type: 'stopwatch', unit: null, labelOptions: null }

  const base = { ...RECORD, source: 'manual' as const, externalId: null, comment: null, timezone: 'Europe/Paris' }
  const entry = (id: string, habit: Habit, occurredStart: string, value: unknown, extra: Partial<Entry> = {}) =>
    ({ ...base, id, habitId: habit.id, habitType: habit.type, occurredStart, occurredEnd: null, value, ...extra }) as Entry

  it('number habits: total or average per day, in the display timezone', () => {
    const entries = [
      entry('a', water, '2026-11-09T07:00:00.000Z', 500),
      entry('b', water, '2026-11-09T18:00:00.000Z', 750),
      // 23:30 UTC on the 9th is 00:30 on the 10th in Paris
      entry('c', water, '2026-11-09T23:30:00.000Z', 250),
    ]

    expect(habitDailyObservations(water, entries, 'event')).toEqual([
      { date: '2026-11-09', value: 1250 },
      { date: '2026-11-10', value: 250 },
    ])
    expect(habitDailyObservations(water, entries, 'UTC')).toEqual([{ date: '2026-11-09', value: 1500 }])

    const weights = [
      entry('d', weight, '2026-11-09T07:00:00.000Z', 72),
      entry('e', weight, '2026-11-09T19:00:00.000Z', 73),
    ]
    expect(habitDailyObservations(weight, weights, 'event')).toEqual([{ date: '2026-11-09', value: 72.5 }])
  })

  it('checkbox: 1 if any Done that day; stopwatch: total hours; deleted entries ignored', () => {
    expect(
      habitDailyObservations(gym, [
        entry('a', gym, '2026-11-09T07:00:00.000Z', false),
        entry('b', gym, '2026-11-09T19:00:00.000Z', true),
        entry('c', gym, '2026-11-10T19:00:00.000Z', false),
        entry('d', gym, '2026-11-11T19:00:00.000Z', true, { deletedAt: '2026-11-12T00:00:00.000Z' }),
      ], 'event'),
    ).toEqual([
      { date: '2026-11-09', value: 1 },
      { date: '2026-11-10', value: 0 },
    ])

    const session = (id: string, start: string, end: string) =>
      entry(id, reading, start, { segments: [{ start, end }] }, { occurredEnd: end })

    expect(
      habitDailyObservations(reading, [
        session('a', '2026-11-09T07:00:00.000Z', '2026-11-09T08:30:00.000Z'),
        session('b', '2026-11-09T18:00:00.000Z', '2026-11-09T18:30:00.000Z'),
      ], 'event'),
    ).toEqual([{ date: '2026-11-09', value: 2 }])
  })

  it('label habits have no daily numbers but their values can be listed', () => {
    const mood: Habit = { ...HABIT, id: 'mood', name: 'Mood', type: 'label', unit: null, labelOptions: ['Good', 'Bad'] }
    const entries = [entry('a', mood, '2026-11-09T07:00:00.000Z', 'Good')]

    expect(habitDailyObservations(mood, entries, 'event')).toEqual([])
    expect(habitTextValues(mood, entries, 'event')).toEqual([{ date: '2026-11-09', value: 'Good' }])
  })

  it('sleep: one observation per night, in hours and on the axis', () => {
    const { nights } = processSleep([
      {
        ...RECORD,
        id: 's',
        source: 'manual',
        externalId: null,
        sourceApp: null,
        dedupeKey: 'manual:s',
        startUtc: '2026-11-08T22:30:00.000Z',
        endUtc: '2026-11-09T06:00:00.000Z',
        timezone: 'Europe/Paris',
        startOffsetMinutes: null,
        endOffsetMinutes: null,
        stages: [],
        reportedSleepMs: null,
        comment: null,
        importedAt: null,
        metadata: null,
      },
    ])

    expect(sleepObservations(nights)).toEqual({
      sleepDuration: [{ date: '2026-11-08', value: 7.5 }],
      timeInBed: [{ date: '2026-11-08', value: 7.5 }],
      bedtime: [{ date: '2026-11-08', value: 23.5 }],
      wakeTime: [{ date: '2026-11-08', value: 31 }],
    })
  })
})

describe('buildSectionStats', () => {
  const range = { start: '2026-11-08', end: '2026-11-14' }
  const daily = [
    // previous week (1–7 Nov): mean 7
    ...[6, 7, 8, 7, 7].map((value, i) => ({ date: `2026-11-0${i + 1}`, value })),
    // this week: 8 7 9 8 8 (mean 8) and one missing day
    ...[8, 7, 9, 8, 8].map((value, i) => ({ date: `2026-11-${String(8 + i).padStart(2, '0')}`, value })),
    { date: '2026-11-13', value: null },
  ]

  it('uses one value per day in the range for statistics, delta and metrics', () => {
    const stats = buildSectionStats({
      subject: 'sleepDuration',
      daily,
      range,
      aggregation: 'week',
      target: 8,
      metricIds: ['median', 'coefficient-of-variation', 'unknown-metric'],
    })

    expect(stats.dailyInRange).toHaveLength(6)
    expect(stats.summary).toMatchObject({ n: 5, missing: 1, mean: 8, median: 8 })
    expect(stats.summary.rmsd).toMatchObject({ reference: 'target', bias: 0 })
    expect(stats.previousRange).toEqual({ start: '2026-11-01', end: '2026-11-07' })
    expect(stats.delta).toMatchObject({ currentMean: 8, previousMean: 7, absolute: 1 })
    expect(stats.metrics.map((m) => [m.metric.id, m.result.status])).toEqual([
      ['median', 'ok'],
      ['coefficient-of-variation', 'ok'],
    ])
    // Sunday 8 Nov belongs to the week of Monday 2 Nov.
    expect(stats.series).toEqual([
      { period: '2026-11-02', value: 8, n: 1 },
      { period: '2026-11-09', value: 8, n: 4 },
    ])
  })

  it('leaves out metrics that do not apply (no CV for bedtime)', () => {
    const stats = buildSectionStats({
      subject: 'bedtime',
      daily,
      range,
      aggregation: 'day',
      target: null,
      metricIds: ['coefficient-of-variation', 'median'],
    })

    expect(stats.metrics.map((m) => m.metric.id)).toEqual(['median'])
  })
})

describe('format', () => {
  it('formats values by subject', () => {
    expect(formatValue('sleepDuration', 7.5)).toBe('7 h 30 min')
    expect(formatValue('bedtime', 24.5)).toBe('00:30')
    expect(formatValue('checkbox', 0.756)).toBe('76 %')
    expect(formatValue('number', 1250.456, 'ml')).toBe('1,250.46 ml')
    expect(formatValue('stopwatch', 0.25)).toBe('15 min')
  })

  it('shows spreads of clock times in minutes and durations in hours and minutes', () => {
    expect(formatSpread('bedtime', 0.5)).toBe('30 min')
    expect(formatSpread('sleepDuration', 0.75)).toBe('45 min')
    expect(formatSpread('sleepDuration', 1.5)).toBe('1 h 30 min')
    expect(formatSpread('number', 2, 'kg')).toBe('2 kg')
  })

  it('shows signed changes', () => {
    expect(formatChange('bedtime', 0.25)).toBe('+15 min')
    expect(formatChange('number', -0.5, 'kg')).toBe('−0.5 kg')
    expect(formatChange('sleepDuration', 0)).toBe('±0 min')
  })
})

describe('dashboard settings and loading', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(async () => {
    db.close()
    await db.delete()
  })

  it('stores metric choices per section with defaults for others', async () => {
    const defaults = ['stat:mean', 'stat:change', 'extra:stopwatch-total', 'extra:location-modes', 'extra:location-active-distance']
    expect(metricsForSection(await loadMetricSelection(), 'bedtime')).toEqual(defaults)

    await saveSectionMetrics('bedtime', ['percentiles'])
    await saveSectionMetrics('habit:x', [])

    const selection = await loadMetricSelection()
    expect(metricsForSection(selection, 'bedtime')).toEqual(['percentiles'])
    expect(metricsForSection(selection, 'habit:x')).toEqual([])
    expect(metricsForSection(selection, 'wakeTime')).toEqual(defaults)
  })

  it('rejects malformed metric selections', () => {
    expect(parseMetricSelection('{"a": ["median"]}')).toEqual({ a: ['median'] })
    expect(parseMetricSelection('[1]')).toBeNull()
    expect(parseMetricSelection('{"a": [1]}')).toBeNull()
    expect(parseMetricSelection('not json')).toBeNull()
  })

  it('loads active habits, non-deleted entries, sleep analysis and settings', async () => {
    const water = await createHabit({ name: 'Water', type: 'number' })
    const old = await createHabit({ name: 'Old', type: 'checkbox' })
    await setHabitArchived(old.id, true)
    await createEntry({ habitId: water.id, value: 1, occurredStart: '2026-11-09T08:00:00.000Z' })
    const removed = await createEntry({ habitId: water.id, value: 2, occurredStart: '2026-11-09T09:00:00.000Z' })
    await deleteEntry(removed.id)
    await createManualSleepSession({ startUtc: '2026-11-08T22:30:00Z', endUtc: '2026-11-09T06:00:00Z' })
    await saveSleepTargets({ sleepDuration: '8:00', bedtime: '', wakeTime: '' })

    const data = await loadDashboardData()

    expect(data.habits.map((habit) => habit.name)).toEqual(['Water'])
    expect(data.entries).toHaveLength(1)
    expect(data.sleep.nights).toHaveLength(1)
    expect(data.targets.sleepDurationMinutes).toBe(480)
    expect(data.displayTimezone).toBe('event')
  })

  it('puts each kind of external sample in its own field and leaves out deleted ones', async () => {
    const sample = (id: string, measurementType: string, deletedAt: string | null = null): ExternalSample => ({
      ...RECORD,
      deletedAt,
      id,
      source: 'import',
      externalId: null,
      sourceApp: null,
      dedupeKey: id,
      measurementType,
      value: 1,
      unit: null,
      startUtc: '2026-11-09T08:00:00.000Z',
      endUtc: null,
      timezone: 'Europe/Paris',
      startOffsetMinutes: 60,
      importedAt: '2026-11-09T08:00:00.000Z',
      metadata: null,
    })
    await db.externalSamples.bulkAdd([
      sample('screen', SCREEN_TIME_DAILY),
      sample('screen-deleted', SCREEN_TIME_DAILY, '2026-11-10T00:00:00.000Z'),
      sample('visit', LOCATION_VISIT),
      sample('movement', LOCATION_MOVEMENT),
      sample('health', HEALTH_MEASUREMENT_TYPES[0]),
      sample('ynab', YNAB_MEASUREMENT),
      sample('ynab-deleted', YNAB_MEASUREMENT, '2026-11-10T00:00:00.000Z'),
      sample('other', 'some_other_type'),
    ])
    // Two settings of the same shape must not be swapped.
    await saveChosenApps(['Chat'])
    await saveChosenCategories(['Groceries'])

    const data = await loadDashboardData()
    const ids = (samples: ExternalSample[]) => samples.map((s) => s.id).sort()

    expect(ids(data.screenTime)).toEqual(['screen'])
    expect(ids(data.location)).toEqual(['movement', 'visit'])
    expect(ids(data.health)).toEqual(['health'])
    expect(ids(data.ynab)).toEqual(['ynab'])
    expect(data.screenTimeApps).toEqual(['Chat'])
    expect(data.ynabCategories).toEqual(['Groceries'])
  })
})

describe('aggregateMany (several series on the same periods)', () => {
  it('one row per period with each series value (mean per day with data) and its day count', () => {
    const rows = aggregateMany([
      { key: 'Chat', daily: [{ date: '2026-11-09', value: 1 }, { date: '2026-11-10', value: 3 }] },
      { key: 'Maps', daily: [{ date: '2026-11-10', value: 0.5 }] },
    ], { start: '2026-11-09', end: '2026-11-15' }, 'week')
    expect(rows).toEqual([{ period: '2026-11-09', values: { Chat: 2, Maps: 0.5 }, n: { Chat: 2, Maps: 1 } }])

    const days = aggregateMany([{ key: 'Chat', daily: [{ date: '2026-11-09', value: 1 }] }], { start: '2026-11-09', end: '2026-11-10' }, 'day')
    expect(days).toEqual([
      { period: '2026-11-09', values: { Chat: 1 }, n: { Chat: 1 } },
      { period: '2026-11-10', values: { Chat: null }, n: { Chat: 0 } },
    ])
  })
})

describe('moving through periods', () => {
  it('a small step is about a seventh of the range', () => {
    expect(smallStep({ start: '2026-11-04', end: '2026-11-10' })).toBe(1) // 7 days
    expect(smallStep({ start: '2026-10-12', end: '2026-11-10' })).toBe(5) // 30 days
    expect(smallStep({ start: '2026-08-13', end: '2026-11-10' })).toBe(13) // 90 days
  })

  it('moves both ends and never ends after today', () => {
    expect(shiftRange({ start: '2026-11-07', end: '2026-11-13' }, -7, '2026-11-13')).toEqual({ start: '2026-10-31', end: '2026-11-06' })
    expect(shiftRange({ start: '2026-10-31', end: '2026-11-06' }, 10, '2026-11-13')).toEqual({ start: '2026-11-07', end: '2026-11-13' })
    // Across the month and year boundaries.
    expect(shiftRange({ start: '2026-01-01', end: '2026-01-07' }, -7, '2026-11-13')).toEqual({ start: '2025-12-25', end: '2025-12-31' })
  })

  it('tells swipes from scrolling: short = small step, long = whole period, right = earlier', () => {
    expect(swipeMove(30, 0, 400)).toBeNull() // too short
    expect(swipeMove(80, 60, 400)).toBeNull() // mostly vertical (scrolling)
    expect(swipeMove(80, 10, 400)).toEqual({ size: 'small', direction: -1 })
    expect(swipeMove(-80, 10, 400)).toEqual({ size: 'small', direction: 1 })
    expect(swipeMove(160, 0, 400)).toEqual({ size: 'full', direction: -1 }) // 40 % of the width
    expect(swipeMove(130, 0, 1200)).toEqual({ size: 'small', direction: -1 }) // under 35 % of a wide screen
  })
})

