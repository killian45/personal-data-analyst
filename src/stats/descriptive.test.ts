import { describe as group, expect, it } from 'vitest'

import {
  cleanValues,
  describe,
  iqr,
  mean,
  median,
  populationSd,
  quantile,
  rmsd,
  sampleSd,
} from './descriptive'

// Hand-calculated reference data set (sorted: 2 4 4 4 5 5 7 9):
//   mean = 40 / 8 = 5
//   population SD = sqrt(32 / 8) = 2
//   sample SD = sqrt(32 / 7) ≈ 2.138090
//   type 7: Q1 at h = 7·0.25 = 1.75 → 4 + 0.75·(4 − 4) = 4
//           Q3 at h = 7·0.75 = 5.25 → 5 + 0.25·(7 − 5) = 5.5 → IQR 1.5
//           median at h = 3.5 → 4 + 0.5·(5 − 4) = 4.5
//   RMSD around target 6: squared deviations 16 4 4 4 1 1 1 9 = 40 → sqrt(5)
const DATA = [5, 2, 4, 7, 4, 9, 4, 5]

group('cleanValues', () => {
  it('excludes and counts missing and invalid values, never as zero', () => {
    expect(cleanValues([1, null, 2, undefined, Number.NaN, Number.POSITIVE_INFINITY, 0])).toEqual({
      values: [1, 2, 0],
      missing: 4,
    })
  })
})

group('basic statistics (hand-calculated)', () => {
  it('mean, median, quartiles and IQR', () => {
    expect(mean(DATA)).toBe(5)
    expect(median(DATA)).toBe(4.5)
    expect(quantile(DATA, 0.25)).toBe(4)
    expect(quantile(DATA, 0.75)).toBe(5.5)
    expect(iqr(DATA)).toBe(1.5)
  })

  it('sample SD uses n − 1, population SD uses n', () => {
    expect(sampleSd(DATA)).toBeCloseTo(Math.sqrt(32 / 7), 12)
    expect(populationSd(DATA)).toBe(2)
  })

  it('type 7 quantiles at the extremes and between values', () => {
    expect(quantile(DATA, 0)).toBe(2)
    expect(quantile(DATA, 1)).toBe(9)
    // h = 7·0.9 = 6.3 → 7 + 0.3·(9 − 7) = 7.6
    expect(quantile(DATA, 0.9)).toBeCloseTo(7.6, 12)
  })

  it('handles a single value', () => {
    expect(median([3])).toBe(3)
    expect(iqr([3])).toBe(0)
    expect(populationSd([3])).toBe(0)
  })

  it('refuses empty input and invalid probabilities', () => {
    expect(() => mean([])).toThrow('At least one value is required.')
    expect(() => quantile([1, 2], 1.5)).toThrow('between 0 and 1')
    expect(() => sampleSd([1])).toThrow('at least 2 values')
  })
})

group('rmsd', () => {
  it('with a target: RMSD, bias and spread, and RMSD² = bias² + spread²', () => {
    const result = rmsd(DATA, 6)

    expect(result.reference).toBe('target')
    expect(result.rmsd).toBeCloseTo(Math.sqrt(5), 12)
    expect(result.bias).toBe(-1)
    expect(result.spread).toBe(2)
    expect(result.rmsd ** 2).toBeCloseTo((result.bias ?? 0) ** 2 + (result.spread ?? 0) ** 2, 12)
  })

  it('without a target: RMSD around the mean equals the population SD', () => {
    expect(rmsd(DATA)).toEqual({ rmsd: 2, reference: 'mean', bias: null, spread: null })
  })

  it('refuses a non-finite target', () => {
    expect(() => rmsd(DATA, Number.NaN)).toThrow('The target must be a finite number.')
  })
})

group('describe', () => {
  it('returns every statistic for enough observations', () => {
    expect(describe([...DATA, null], { target: 6 })).toMatchObject({
      n: 8,
      missing: 1,
      insufficient: false,
      mean: 5,
      median: 4.5,
      min: 2,
      max: 9,
      iqr: 1.5,
      rmsd: { reference: 'target', bias: -1, spread: 2 },
    })
  })

  it('reports insufficient data below 5 observations, but always gives n', () => {
    expect(describe([1, 2, 3, 4, null])).toEqual({
      n: 4,
      missing: 1,
      insufficient: true,
      mean: null,
      median: null,
      sampleSd: null,
      min: null,
      max: null,
      iqr: null,
      rmsd: null,
    })
  })

  it('treats exactly 5 observations as sufficient', () => {
    expect(describe([1, 2, 3, 4, 5]).insufficient).toBe(false)
  })

  it('handles empty input', () => {
    expect(describe([])).toMatchObject({ n: 0, missing: 0, insufficient: true })
  })

  it('handles very long lists', () => {
    const many = Array.from({ length: 200_000 }, (_, index) => index % 10)
    expect(describe(many)).toMatchObject({ min: 0, max: 9 })
  })
})
