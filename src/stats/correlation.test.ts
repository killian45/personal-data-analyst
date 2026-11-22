import { describe, expect, it } from 'vitest'

import {
  benjaminiHochberg,
  correlate,
  describeStrength,
  effectiveSampleSize,
  lag1Autocorrelation,
  pairObservations,
  pearson,
  ranks,
  spearman,
} from './correlation'
import { studentTTwoSidedP } from './distributions'
import { addDays } from './subjects'
import type { Observation } from './subjects'

// Anscombe's quartet, set I (published: r = 0.816, p = 0.00217).
const AX = [10, 8, 13, 9, 11, 14, 6, 4, 12, 7, 5]
const AY = [8.04, 6.95, 7.58, 8.81, 8.33, 9.96, 7.24, 4.26, 10.84, 4.82, 5.68]

/** Observations every `step` days from 1 Oct 2026. */
function series(values: (number | null)[], step = 1, start = '2026-10-01'): Observation[] {
  return values.map((value, i) => ({ date: addDays(start, i * step), value }))
}

describe('pearson and spearman', () => {
  it('match Anscombe I (r) and a hand calculation (ρ = 1 − 6·40/(11·120))', () => {
    expect(pearson(AX, AY)).toBeCloseTo(0.81642051634484, 12)
    expect(spearman(AX, AY)).toBeCloseTo(1 - 240 / 1320, 12)
  })

  it('give ±1 for exact linear relations and null without variation', () => {
    expect(pearson([1, 2, 3], [2, 4, 6])).toBeCloseTo(1, 12)
    expect(pearson([1, 2, 3], [3, 2, 1])).toBeCloseTo(-1, 12)
    expect(pearson([1, 2, 3], [5, 5, 5])).toBeNull()
    expect(pearson([1], [2])).toBeNull()
    expect(() => pearson([1, 2], [1])).toThrow()
  })

  it('ranks ties with their average rank; Spearman sees monotonic, not linear', () => {
    expect(ranks([10, 20, 20, 30])).toEqual([1, 2.5, 2.5, 4])
    expect(ranks([3, 1, 2])).toEqual([3, 1, 2])
    expect(spearman([1, 2, 3, 4, 5], [1, 4, 9, 16, 1000])).toBeCloseTo(1, 12)
  })
})

describe('pairing with a delay', () => {
  it('pairs X on day d with Y on day d + lag and leaves out days missing either', () => {
    const x = series([1, 2, null, 4])
    const y = series([10, 20, 30, 40, 50])
    expect(pairObservations(x, y, 0)).toEqual([
      { date: '2026-10-01', x: 1, y: 10 },
      { date: '2026-10-02', x: 2, y: 20 },
      { date: '2026-10-04', x: 4, y: 40 },
    ])
    expect(pairObservations(x, y, 1).map((pair) => [pair.x, pair.y])).toEqual([[1, 20], [2, 30], [4, 50]])
    expect(() => pairObservations(x, y, 8)).toThrow(/0 to 7/)
    expect(() => pairObservations(x, y, -1)).toThrow()
  })
})

describe('day-to-day dependence', () => {
  it('computes lag-1 autocorrelation from consecutive calendar days only', () => {
    // 1,2,1,2,1,2 on consecutive days → each day is the opposite of the previous: r1 = −1.
    expect(lag1Autocorrelation(series([1, 2, 1, 2, 1, 2]).map((o) => ({ date: o.date, value: o.value as number })))).toBeCloseTo(-1, 12)
    // Every other day: no consecutive pairs → cannot be estimated.
    expect(lag1Autocorrelation(series([1, 2, 3, 4], 2).map((o) => ({ date: o.date, value: o.value as number })))).toBeNull()
  })

  it("computes Bartlett's effective number of days, never above n", () => {
    expect(effectiveSampleSize(30, 0.5, 0.4)).toBeCloseTo(30 * 0.8 / 1.2, 12) // 20
    expect(effectiveSampleSize(30, 0.5, -0.4)).toBe(30) // a negative product would exceed n
    expect(effectiveSampleSize(30, null, 0.9)).toBe(30) // unknown r1 → 0
    expect(effectiveSampleSize(30, 1, 1)).toBe(0)
  })
})

describe('correlate', () => {
  it('reproduces Anscombe I with intervals and p (no dependence correction when days are not consecutive)', () => {
    const result = correlate(series(AX, 2), series(AY, 2))
    expect(result.status).toBe('ok')
    expect([result.n, result.nEffective]).toEqual([11, 11])
    expect(result.pearson?.value).toBeCloseTo(0.81642051634484, 12)
    expect(result.pearson?.low).toBeCloseTo(0.42439121339321656, 10) // Fisher z
    expect(result.pearson?.high).toBeCloseTo(0.9506932537865606, 10)
    expect(result.pearson?.p).toBeCloseTo(0.0021696, 6) // published 0.00217
    expect(result.spearman?.value).toBeCloseTo(0.8181818181818181, 12)
    expect(result.spearman?.low).toBeCloseTo(0.3370204870698273, 10) // Bonett–Wright
    expect(result.spearman?.high).toBeCloseTo(0.9604636343630893, 10)
  })

  it('shrinks the evidence for two trending series (they look correlated but are "sticky")', () => {
    const days = Array.from({ length: 30 }, (_, i) => i)
    const result = correlate(series(days.map((i) => i + (i % 3))), series(days.map((i) => 2 * i + (i % 2))))
    expect(result.pearson?.value).toBeGreaterThan(0.99)
    // Both series rise day after day (r1 ≈ 1) → almost no independent days left.
    expect(result.status).toBe('too-dependent')
    expect(result.nEffective).toBeLessThanOrEqual(4)
    expect([result.pearson?.low, result.pearson?.high, result.pearson?.p]).toEqual([null, null, null])
  })

  it('uses the effective number of days for the p-value and interval (wiring check)', () => {
    // 20 consecutive days, mildly "sticky" pattern.
    const xv = [3, 4, 4, 5, 3, 2, 3, 5, 6, 5, 4, 3, 3, 4, 6, 7, 6, 4, 3, 2]
    const yv = [2, 3, 5, 4, 3, 3, 2, 4, 6, 6, 5, 3, 2, 5, 5, 6, 7, 5, 2, 3]
    const result = correlate(series(xv), series(yv))
    const nEff = effectiveSampleSize(20, result.autocorrelation.x, result.autocorrelation.y)
    expect(result.autocorrelation.x).not.toBeNull()
    expect(result.nEffective).toBeCloseTo(nEff, 12)
    expect(result.nEffective).toBeLessThan(20)
    const r = result.pearson!.value
    expect(result.pearson!.p).toBeCloseTo(studentTTwoSidedP(r * Math.sqrt((nEff - 2) / (1 - r * r)), nEff - 2), 12)
    expect(result.pearson!.high).toBeCloseTo(Math.tanh(Math.atanh(r) + 1.959963984540054 / Math.sqrt(nEff - 3)), 12)
  })

  it('refuses fewer than 10 paired days and series without variation', () => {
    expect(correlate(series([1, 2, 3, 4, 5, 6, 7, 8, 9]), series([1, 2, 3, 4, 5, 6, 7, 8, 9])).status).toBe('too-few-days')
    expect(correlate(series(Array(12).fill(5), 2), series(AX.concat([1]), 2)).status).toBe('no-variation')
  })

  it('applies the delay: X on day d with Y on day d + 1', () => {
    const x = series(AX, 2)
    const y = AY.map((value, i) => ({ date: addDays(x[i].date, 1), value })) // each Y one day after its X
    expect(correlate(x, y, 0).status).toBe('too-few-days') // no same-day pairs
    const delayed = correlate(x, y, 1)
    expect(delayed.lag).toBe(1)
    expect(delayed.n).toBe(11)
    expect(delayed.pearson?.value).toBeCloseTo(0.81642051634484, 12)
  })
})

describe('strength and multiple comparisons', () => {
  it('describes strength with documented thresholds', () => {
    expect([0.05, -0.2, 0.35, -0.8].map(describeStrength)).toEqual(['negligible', 'weak', 'moderate', 'strong'])
  })

  it('adjusts p-values with Benjamini–Hochberg (hand-calculated)', () => {
    // Sorted 0.005, 0.01, 0.03, 0.04 → p·4/rank = 0.02, 0.02, 0.04, 0.04 (already monotone).
    const adjusted = benjaminiHochberg([0.01, 0.04, 0.03, 0.005])
    expect(adjusted.map((p) => (p === null ? null : Math.round(p * 1e12) / 1e12))).toEqual([0.02, 0.04, 0.04, 0.02])
    expect(benjaminiHochberg([0.5, null, 0.01])).toEqual([0.5, null, 0.02])
    // Monotonicity: a large p cannot be adjusted below a smaller one.
    expect(benjaminiHochberg([0.04, 0.041])).toEqual([0.041, 0.041])
  })
})
