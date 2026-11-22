import { describe, expect, it } from 'vitest'

import { DEFAULT_SECTION_METRICS, metricsForSection } from './dashboardMetrics'

describe('metricsForSection', () => {
  it('uses a few relevant values when nothing was chosen', () => {
    expect(DEFAULT_SECTION_METRICS).toEqual([
      'stat:mean',
      'stat:change',
      'extra:stopwatch-total',
      'extra:location-modes',
      'extra:location-active-distance',
    ])
    expect(metricsForSection({}, 'sleepDuration')).toEqual(DEFAULT_SECTION_METRICS)
  })

  it('uses a saved choice as is (marker removed), even if it hides every statistic', () => {
    expect(metricsForSection({ bedtime: ['choice:v2', 'stat:median'] }, 'bedtime')).toEqual(['stat:median'])
    expect(metricsForSection({ bedtime: ['choice:v2'] }, 'bedtime')).toEqual([])
  })

  it('keeps choices saved before the change and adds the default statistics', () => {
    expect(metricsForSection({ bedtime: ['linear-trend', 'percentiles'] }, 'bedtime')).toEqual([
      'stat:mean',
      'stat:change',
      'extra:stopwatch-total',
      'extra:location-modes',
      'extra:location-active-distance',
      'linear-trend',
      'percentiles',
    ])
  })

  it('treats old choices of the registry median and IQR as the standard statistics', () => {
    expect(metricsForSection({ bedtime: ['median', 'iqr'] }, 'bedtime')).toEqual([
      'stat:mean',
      'stat:change',
      'extra:stopwatch-total',
      'extra:location-modes',
      'extra:location-active-distance',
      'stat:median',
      'stat:iqr',
    ])
  })
})
