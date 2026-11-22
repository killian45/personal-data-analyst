import { describe, expect, it } from 'vitest'

import { appDailyObservations, appUsageTotals, screenTimeObservations } from './dailyScreenTime'
import { buildScreenTimeDedupeKey } from './screenTime'
import { screenTimeSample } from './testScreenTime'

function phoneDay(id: string, date: string, seconds: number) {
  return screenTimeSample(id, date, {
    source: 'android_usage',
    dedupeKey: buildScreenTimeDedupeKey('android_usage', date),
    value: seconds,
  })
}

describe('screenTimeObservations', () => {
  it('gives one value per day in hours, preferring the phone over App Usage files', () => {
    const series = screenTimeObservations([
      screenTimeSample('f-8', '2026-11-08', { value: 7200 }),
      screenTimeSample('f-9', '2026-11-09', { value: 3600 }),
      phoneDay('p-9', '2026-11-09', 5400),
      phoneDay('p-10', '2026-11-10', 1800),
    ])
    expect(series.daily).toEqual([
      { date: '2026-11-08', value: 2 },
      { date: '2026-11-09', value: 1.5 },
      { date: '2026-11-10', value: 0.5 },
    ])
    expect([series.phoneDays, series.fileDays, series.bothDays]).toEqual([2, 1, 1])
  })

  it('ignores deleted records and other kinds of samples; missing days stay absent', () => {
    const series = screenTimeObservations([
      phoneDay('p-9', '2026-11-09', 5400),
      { ...phoneDay('p-9b', '2026-11-09', 1), deletedAt: '2026-11-10T00:00:00.000Z' },
      screenTimeSample('f-9', '2026-11-09', { value: 3600, deletedAt: '2026-11-10T00:00:00.000Z' }),
      { ...screenTimeSample('x', '2026-11-11'), measurementType: 'steps' },
    ])
    expect(series.daily).toEqual([{ date: '2026-11-09', value: 1.5 }])
    expect(series.bothDays).toBe(0)
  })

  it('is empty without data', () => {
    expect(screenTimeObservations([])).toEqual({ daily: [], phoneDays: 0, fileDays: 0, bothDays: 0 })
  })
})

describe('time per app', () => {
  const meta = (date: string, apps: [string, number][]) => ({ format: 1, localDate: date, apps: apps.map(([name, seconds]) => ({ name, seconds, opens: null })) })
  const samples = [
    screenTimeSample('f-7', '2026-11-07', { metadata: meta('2026-11-07', [['Chat', 3600], ['Maps', 600]]) }),
    screenTimeSample('f-8', '2026-11-08', { metadata: meta('2026-11-08', [['Maps', 1800], [' Chat ', 0]]) }),
    // 8 Nov from the phone too: the phone's apps are used for that day.
    screenTimeSample('p-8', '2026-11-08', {
      source: 'android_usage',
      dedupeKey: buildScreenTimeDedupeKey('android_usage', '2026-11-08'),
      metadata: meta('2026-11-08', [['Maps', 900], ['Camera', 300]]),
    }),
    screenTimeSample('f-9', '2026-11-09', { metadata: meta('2026-11-09', [['Chat', 1200]]), deletedAt: '2026-11-10T00:00:00.000Z' }),
  ]

  it('totals per app over the chosen days, most used first (deleted records ignored)', () => {
    expect(appUsageTotals(samples)).toEqual([
      { name: 'Chat', seconds: 3600, daysUsed: 1 },
      { name: 'Maps', seconds: 1500, daysUsed: 2 }, // 600 + 900 (phone figure on 8 Nov)
      { name: 'Camera', seconds: 300, daysUsed: 1 },
    ])
    expect(appUsageTotals(samples, { start: '2026-11-08', end: '2026-11-08' })).toEqual([
      { name: 'Maps', seconds: 900, daysUsed: 1 },
      { name: 'Camera', seconds: 300, daysUsed: 1 },
    ])
  })

  it('daily hours of one app: 0 on a recorded day without it, nothing on days without a record', () => {
    expect(appDailyObservations(samples, 'Chat')).toEqual([
      { date: '2026-11-07', value: 1 },
      { date: '2026-11-08', value: 0 },
    ])
    expect(appDailyObservations(samples, 'Camera')).toEqual([
      { date: '2026-11-07', value: 0 },
      { date: '2026-11-08', value: 300 / 3600 },
    ])
  })
})

