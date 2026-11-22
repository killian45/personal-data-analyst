import { describe, expect, it } from 'vitest'

import type { CorrelationResult } from '../stats/correlation'

import { correlationWarnings, delayLabel, delayWords, readCorrelation } from './describe'
import { formatMeasureValue } from './format'
import type { Measure } from './measures'

const m = (label: string, kind: Measure['kind'], per: Measure['per'] = 'day', unit: string | null = null): Measure =>
  ({ id: label, label, group: 'Habits', kind, unit, per, daily: [] })
const screen = m('Screen time', 'duration')
const sleep = m('Sleep duration', 'duration', 'night')
const bedtime = m('Bedtime', 'clock', 'night')
const gym = m('Gym', 'binary')

function result(changes: Partial<CorrelationResult>): CorrelationResult {
  return {
    status: 'ok', lag: 0, n: 40, nEffective: 32, autocorrelation: { x: 0.2, y: 0.3 },
    pearson: { value: -0.42, low: -0.68, high: -0.07, p: 0.02 },
    spearman: { value: -0.4, low: -0.7, high: -0.04, p: 0.03 },
    pairs: [], ...changes,
  }
}

describe('readCorrelation', () => {
  it('describes direction, strength, timing and the range in words', () => {
    expect(readCorrelation(result({}), screen, sleep)).toBe(
      'On days when Screen time is higher, Sleep duration (the night starting that evening) tends to be lower — a moderate relation (r = −0.42, 95% range −0.68 to −0.07).',
    )
    expect(readCorrelation(result({ lag: 1, pearson: { value: 0.55, low: 0.3, high: 0.73, p: 0.001 } }), screen, bedtime)).toBe(
      'On days when Screen time is higher, Bedtime (the next night) tends to be later — a strong relation (r = 0.55, 95% range 0.30 to 0.73).',
    )
    expect(readCorrelation(result({ pearson: { value: 0.2, low: 0, high: 0.4, p: 0.06 } }), gym, screen)).toMatch(/^On days when Gym is done, Screen time \(the same day\) tends to be higher — a weak relation/)
  })

  it('says when there is no clear relation, too few days, no variation or too much day-to-day similarity', () => {
    expect(readCorrelation(result({ pearson: { value: 0.05, low: -0.3, high: 0.4, p: 0.8 } }), screen, sleep)).toMatch(/^No clear relation/)
    expect(readCorrelation(result({ status: 'too-few-days', n: 7, pearson: null }), screen, sleep)).toBe(
      'Only 7 days have both values (at least 10 are needed). Keep recording, or choose a longer range.',
    )
    expect(readCorrelation(result({ status: 'no-variation', pearson: null }), screen, sleep)).toMatch(/same value on every shared day/)
    expect(readCorrelation(result({ status: 'too-dependent', n: 30, nEffective: 3.2, pearson: { value: 0.99, low: null, high: null, p: null } }), screen, sleep)).toMatch(
      /^The values move together \(r = 0.99\), but .* the 30 days count as only about 3 independent ones/,
    )
  })
})

describe('delays and warnings', () => {
  it('words the delay with the night-date convention', () => {
    expect(delayWords(screen, sleep, 0)).toBe('the night starting that evening')
    expect(delayWords(sleep, screen, 0)).toBe('the day the night started (the evening before it)')
    expect(delayWords(sleep, screen, 1)).toBe('the next day (after waking up)')
    expect(delayWords(screen, gym, 0)).toBe('the same day')
    expect(delayWords(screen, gym, 3)).toBe('3 days later')
    expect(delayWords(screen, sleep, 2)).toBe('2 nights later')
    expect([0, 1, 5].map(delayLabel)).toEqual(['Same day', '1 day later', '5 days later'])
  })

  it('always warns about causation and one person; adds small-sample, dependence and clock notes', () => {
    const warnings = correlationWarnings(result({ n: 20, nEffective: 14 }), screen, bedtime)
    expect(warnings[0]).toMatch(/does not show that one causes the other/)
    expect(warnings[1]).toMatch(/one person/)
    expect(warnings.some((w) => w.startsWith('Small sample: 20 days'))).toBe(true)
    expect(warnings.some((w) => w.includes('count as about 14 independent ones'))).toBe(true)
    expect(warnings.some((w) => w.includes('00:30 counts as 24:30'))).toBe(true)
    expect(correlationWarnings(result({ n: 40, nEffective: 40 }), screen, sleep)).toHaveLength(2)
  })

  it('formats values by kind', () => {
    expect(formatMeasureValue(screen, 1.5)).toBe('1 h 30 min')
    expect(formatMeasureValue(bedtime, 24.5)).toBe('00:30')
    expect(formatMeasureValue(gym, 1)).toBe('Done')
    expect(formatMeasureValue(m('Water', 'number', 'day', 'ml'), 750)).toBe('750 ml')
  })
})
