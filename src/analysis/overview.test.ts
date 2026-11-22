import { describe, expect, it } from 'vitest'

import { benjaminiHochberg, correlate } from '../stats/correlation'
import { addDays } from '../stats/subjects'

import type { Measure } from './measures'
import { buildOverview, MAX_OVERVIEW_MEASURES, measureWindow } from './overview'

const m = (id: string, values: (number | null)[], start = '2026-10-01', step = 2): Measure => ({
  id, label: id, group: 'Habits', kind: 'number', unit: null, per: 'day',
  daily: values.map((value, i) => ({ date: addDays(start, i * step), value })),
})

// Every other day (no day-to-day correction), 12 days.
const A = m('A', [1, 3, 2, 4, 1, 2, 5, 3, 2, 4, 1, 3])
const B = m('B', [2, 6, 4, 9, 2, 4, 10, 6, 5, 8, 2, 6]) // almost 2 × A
const C = m('C', [5, 1, 4, 2, 3, 5, 1, 2, 4, 3, 5, 2]) // unrelated-ish
const SHORT = m('Short', [1, 2, 3, 4, 5]) // too few days
const FLAT = m('Flat', Array(12).fill(7)) // no variation

describe('measureWindow', () => {
  it('keeps X days in the range and Y days in the range moved by the delay', () => {
    const range = { start: '2026-10-03', end: '2026-10-07' }
    expect(measureWindow(A, range, 0).map((o) => o.date)).toEqual(['2026-10-03', '2026-10-05', '2026-10-07'])
    expect(measureWindow(A, range, 2).map((o) => o.date)).toEqual(['2026-10-05', '2026-10-07', '2026-10-09'])
    expect(measureWindow(A, null, 3)).toBe(A.daily)
  })
})

describe('buildOverview', () => {
  it('compares every pair once, adjusts p-values over the comparable pairs, and sorts by strength', () => {
    const overview = buildOverview([A, B, C, SHORT, FLAT], null)
    expect(overview.pairs).toBe(10) // 5 measures → 5·4/2
    // Comparable: A–B, A–C, B–C. Pairs with Short: too few days; with Flat: no variation.
    expect(overview.comparisons).toBe(3)

    const names = overview.rows.map((row) => `${row.x.id}-${row.y.id}:${row.result.status}`)
    expect(names[0]).toBe('A-B:ok') // strongest first
    expect(names.slice(3)).toEqual([
      'A-Flat:no-variation', 'B-Flat:no-variation', 'C-Flat:no-variation',
      'A-Short:too-few-days', 'B-Short:too-few-days', 'C-Short:too-few-days', 'Short-Flat:too-few-days',
    ])

    // Adjusted p-values equal Benjamini–Hochberg over the three comparable pairs.
    const ps = [correlate(A.daily, B.daily), correlate(A.daily, C.daily), correlate(B.daily, C.daily)].map((r) => r.pearson!.p)
    const expected = benjaminiHochberg(ps)
    const byPair = new Map(overview.rows.map((row) => [`${row.x.id}-${row.y.id}`, row.adjustedP]))
    expect([byPair.get('A-B'), byPair.get('A-C'), byPair.get('B-C')]).toEqual(expected)
    expect(byPair.get('A-Short')).toBeNull()
  })

  it('applies the date range', () => {
    const overview = buildOverview([A, B], { start: '2026-10-01', end: '2026-10-10' })
    expect(overview.rows[0].result.status).toBe('too-few-days') // only 5 days in range
    expect(overview.rows[0].result.n).toBe(5)
  })

  it('handles fewer than two measures and refuses too many', () => {
    expect(buildOverview([A], null)).toEqual({ rows: [], comparisons: 0, pairs: 0 })
    const many = Array.from({ length: MAX_OVERVIEW_MEASURES + 1 }, (_, i) => m(`M${i}`, [1, 2]))
    expect(() => buildOverview(many, null)).toThrow(/at most 20/)
  })
})
