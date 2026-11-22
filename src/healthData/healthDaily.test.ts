import { describe, expect, it } from 'vitest'

import type { ExternalSample } from '../database/types'

import { exerciseSummary, healthSeries } from './healthDaily'

const sample = (type: string, date: string, value: number, origin: string, changes: Partial<ExternalSample> = {}) =>
  ({ measurementType: type, sourceApp: origin, value, deletedAt: null, metadata: { localDate: date }, ...changes }) as ExternalSample

describe('healthSeries', () => {
  const samples = [
    sample('hc_steps_daily', '2026-11-08', 4000, 'watch'),
    sample('hc_steps_daily', '2026-11-09', 5000, 'watch'),
    sample('hc_steps_daily', '2026-11-09', 6200, 'phone'),
    sample('hc_steps_daily', '2026-11-10', 7000, 'phone'),
    sample('hc_steps_daily', '2026-11-11', 8000, 'phone'),
    sample('hc_steps_daily', '2026-11-11', 9999, 'phone2', { deletedAt: '2026-11-12T00:00:00.000Z' }),
    sample('hc_distance_daily', '2026-11-10', 2500, 'phone'),
  ]

  it('uses one source per kind (the one with most days), never adding sources together', () => {
    expect(healthSeries(samples, 'steps')).toEqual({
      origin: 'phone',
      origins: ['phone', 'watch'],
      daily: [{ date: '2026-11-09', value: 6200 }, { date: '2026-11-10', value: 7000 }, { date: '2026-11-11', value: 8000 }],
    })
  })

  it('chooses the source within the shown dates', () => {
    expect(healthSeries(samples, 'steps', { start: '2026-11-08', end: '2026-11-09' }).origin).toBe('watch') // 2 days against 1
    expect(healthSeries(samples, 'steps', { start: '2026-11-09', end: '2026-11-09' }).origin).toBe('phone') // tie 1–1: alphabetical
  })

  it('distance in kilometres; no data → no source', () => {
    expect(healthSeries(samples, 'distance').daily).toEqual([{ date: '2026-11-10', value: 2.5 }])
    expect(healthSeries(samples, 'heartRate')).toEqual({ daily: [], origin: null, origins: [] })
  })
})

describe('exerciseSummary', () => {
  it('hours per day with sessions, and totals per type in the shown dates', () => {
    const sessions = [
      sample('hc_exercise', '2026-11-09', 1800, 'watch', { metadata: { localDate: '2026-11-09', exerciseName: 'Walking' } }),
      sample('hc_exercise', '2026-11-09', 2700, 'watch', { metadata: { localDate: '2026-11-09', exerciseName: 'Cycling' } }),
      sample('hc_exercise', '2026-11-10', 3600, 'watch', { metadata: { localDate: '2026-11-10', exerciseName: 'Cycling' } }),
    ]
    expect(exerciseSummary(sessions)).toEqual({
      daily: [{ date: '2026-11-09', value: 1.25 }, { date: '2026-11-10', value: 1 }],
      sessions: 3,
      byType: [{ name: 'Cycling', seconds: 6300, sessions: 2 }, { name: 'Walking', seconds: 1800, sessions: 1 }],
    })
    expect(exerciseSummary(sessions, { start: '2026-11-10', end: '2026-11-10' }).byType).toEqual([{ name: 'Cycling', seconds: 3600, sessions: 1 }])
  })
})
