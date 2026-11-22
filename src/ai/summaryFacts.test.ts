import { describe, expect, it } from 'vitest'

import type { Measure } from '../analysis/measures'
import { addDays } from '../stats/subjects'

import { buildSummaryFacts } from './summaryFacts'

const RANGE = { start: '2026-11-01', end: '2026-11-10' } // previous: 22–31 Oct

function m(id: string, label: string, kind: Measure['kind'], current: number[], previous: number[], extra: Partial<Measure> = {}): Measure {
  return {
    id, label, group: 'Habits', kind, unit: null, per: 'day',
    daily: [
      ...previous.map((value, i) => ({ date: addDays('2026-10-22', i), value })),
      ...current.map((value, i) => ({ date: addDays('2026-11-01', i), value })),
    ],
    ...extra,
  }
}

describe('buildSummaryFacts', () => {
  it('writes one vetted sentence per measure with mean, days and change (hand-calculated)', () => {
    const { facts, included } = buildSummaryFacts([
      // Sleep: mean 7 h 05 (7.0833 h) now vs 7 h 23 (7.3833) before → 18 min less.
      m('sleep:duration', 'Sleep duration', 'duration', Array(10).fill(7 + 5 / 60), Array(10).fill(7 + 23 / 60), { per: 'night' }),
      // Bedtime: 23:48 (23.8) vs 23:26 (23.4333…) → 22 min later.
      m('sleep:bedtime', 'Bedtime', 'clock', Array(10).fill(23.8), Array(10).fill(23.8 - 22 / 60), { per: 'night' }),
      // Distance: 12.5 km vs 10 km → 2.5 km more.
      m('location:distance', 'Distance travelled', 'number', Array(10).fill(12.5), Array(10).fill(10), { unit: 'km' }),
      // Gym: done 4 of 10 days now; 30 % before.
      m('habit:gym', 'Gym', 'binary', [1, 0, 1, 0, 1, 0, 0, 1, 0, 0], [1, 0, 0, 1, 0, 0, 1, 0, 0, 0]),
    ], RANGE)
    expect(facts).toEqual([
      'Period: 01/11/2026 to 10/11/2026 (10 days).',
      'Sleep duration: on average 7 h 05 min per night (10 nights), 18 min less than in the previous period.',
      'Bedtime: on average 23:48 per night (10 nights), 22 min later than in the previous period.',
      'Distance travelled: on average 12.5 km per day (10 days), 2.5 km more than in the previous period.',
      'Gym: done on 4 of 10 days (40 %), up from 30 % in the previous period.',
    ])
    expect(included).toEqual(['Sleep duration', 'Bedtime', 'Distance travelled', 'Gym'])
  })

  it('says when there is no comparison, leaves out measures with too few days and per-place measures', () => {
    const { facts } = buildSummaryFacts([
      m('screenTime', 'Screen time', 'duration', Array(6).fill(4), [1, 2]), // previous has 2 days
      m('habit:rare', 'Rare', 'number', [1, 2, 3], []), // only 3 days in range
      m('location:in:OFFICE', 'Time in Office', 'duration', Array(10).fill(8), Array(10).fill(8)), // places not sent
      m('habit:steady', 'Steady', 'duration', Array(10).fill(1), Array(10).fill(1 + 0.2 / 60)), // 12 s difference
    ], RANGE)
    expect(facts.slice(1)).toEqual([
      'Screen time: on average 4 h 00 min per day (6 days); no comparison with the previous period (too few days).',
      'Steady: on average 1 h 00 min per day (10 days), about the same as in the previous period.',
    ])
  })
})
