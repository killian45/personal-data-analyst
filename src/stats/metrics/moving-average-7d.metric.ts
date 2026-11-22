import { defineMetric } from '../metric'
import { messages } from '../../i18n'
import { NUMERIC_SUBJECTS } from '../subjects'
import { movingAverage } from '../timeseries'

/**
 * 7-day trailing moving average over calendar days. A point needs at
 * least 4 observed days in its window; otherwise it is empty. Missing
 * days are never filled in.
 */
export default defineMetric({
  id: 'moving-average-7d',
  get name() { return messages().metrics['moving-average-7d'].name },
  get description() { return messages().metrics['moving-average-7d'].description },
  category: 'timeseries',
  applicableTypes: NUMERIC_SUBJECTS,
  compute(observations) {
    const missing = observations.filter((o) => typeof o.value !== 'number' || !Number.isFinite(o.value)).length
    const points = movingAverage(observations, { windowDays: 7, minObservations: 4 })
    const n = observations.length - missing

    if (!points.some((point) => point.value !== null)) {
      return {
        status: 'insufficient',
        n,
        missing,
        reason: messages().metrics.noWindow,
      }
    }

    return { status: 'ok', n, missing, value: { kind: 'series', points } }
  },
})
