import { describe, expect, it } from 'vitest'

import { defineMetric } from './metric'
import { buildRegistry, computeMetric, getMetric, getMetrics, metricsFor } from './registry'
import { daily } from './metrics/testData'

const dummy = (id: string) =>
  defineMetric({
    id,
    name: id,
    description: '',
    category: 'descriptive',
    applicableTypes: ['number'],
    compute: () => ({ status: 'not-applicable', reason: 'test' }),
  })

describe('metric registry', () => {
  it('discovers every metric file automatically', () => {
    expect(getMetrics().map((metric) => metric.id)).toEqual([
      'coefficient-of-variation',
      'iqr',
      'linear-trend',
      'median',
      'moving-average-7d',
      'percentiles',
    ])
  })

  it('finds metrics by id and by applicable subject', () => {
    expect(getMetric('median')?.name).toBe('Median')
    expect(getMetric('unknown')).toBeUndefined()
    expect(metricsFor('bedtime').map((metric) => metric.id)).not.toContain('coefficient-of-variation')
    expect(metricsFor('checkbox')).toEqual([])
  })

  it('refuses invalid, misnamed and duplicate metric files', () => {
    expect(() => buildRegistry({ './metrics/a.metric.ts': {} })).toThrow('does not export a valid metric')
    expect(() => buildRegistry({ './metrics/a.metric.ts': { default: dummy('b') } })).toThrow('match its file name')
    expect(() => buildRegistry({ './metrics/Bad_Id.metric.ts': { default: dummy('Bad_Id') } })).toThrow('kebab-case')
    expect(() =>
      buildRegistry({
        './metrics/a.metric.ts': { default: dummy('a') },
        './other/a.metric.ts': { default: dummy('a') },
      }),
    ).toThrow('Duplicate metric id "a"')
  })

  it('computeMetric refuses inapplicable subjects and contains errors', () => {
    const median = getMetric('median')!

    expect(computeMetric(median, daily([1, 2, 3, 4, 5]), { subject: 'checkbox' })).toEqual({
      status: 'not-applicable',
      reason: 'Median does not apply to this kind of data.',
    })

    const broken = defineMetric({
      ...dummy('broken'),
      compute: () => {
        throw new Error('Boom')
      },
    })

    expect(computeMetric(broken, [], { subject: 'number' })).toEqual({ status: 'not-applicable', reason: 'Boom' })
  })
})
