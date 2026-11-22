import { cleanValues, MIN_OBSERVATIONS, quantile } from '../descriptive'
import { messages } from '../../i18n'
import { defineMetric, insufficient } from '../metric'
import { NUMERIC_SUBJECTS } from '../subjects'

export const DEFAULT_PERCENTILES = [0.1, 0.25, 0.5, 0.75, 0.9]

/** Percentiles with Hyndman–Fan type 7 (default: 10, 25, 50, 75, 90). */
export default defineMetric({
  id: 'percentiles',
  get name() { return messages().metrics['percentiles'].name },
  get description() { return messages().metrics['percentiles'].description },
  category: 'descriptive',
  applicableTypes: NUMERIC_SUBJECTS,
  compute(observations, options) {
    const probabilities = options.percentiles ?? DEFAULT_PERCENTILES

    if (probabilities.length === 0 || probabilities.some((p) => !Number.isFinite(p) || p < 0 || p > 1)) {
      return { status: 'not-applicable', reason: messages().metrics.percentileRange }
    }

    const { values, missing } = cleanValues(observations.map((o) => o.value))
    const minN = options.minN ?? MIN_OBSERVATIONS

    if (values.length < minN || values.length === 0) {
      return insufficient(values.length, missing, minN)
    }

    return {
      status: 'ok',
      n: values.length,
      missing,
      value: {
        kind: 'percentiles',
        values: [...probabilities].sort((a, b) => a - b).map((p) => ({ p, value: quantile(values, p) })),
      },
    }
  },
})
