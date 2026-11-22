import { MIN_OBSERVATIONS } from '../descriptive'
import { messages } from '../../i18n'
import { defineMetric, insufficient } from '../metric'
import { NUMERIC_SUBJECTS } from '../subjects'
import { linearTrend } from '../trend'

/**
 * Linear trend (least squares on actual calendar spacing), in units per
 * week. Missing observations are excluded, never interpolated.
 */
export default defineMetric({
  id: 'linear-trend',
  get name() { return messages().metrics['linear-trend'].name },
  get description() { return messages().metrics['linear-trend'].description },
  category: 'trend',
  applicableTypes: NUMERIC_SUBJECTS,
  compute(observations, options) {
    const missing = observations.filter((o) => typeof o.value !== 'number' || !Number.isFinite(o.value)).length
    const minN = options.minN ?? MIN_OBSERVATIONS
    const result = linearTrend(observations, minN)

    if (result.insufficient || result.slopePerWeek === null || result.intercept === null || result.originDate === null) {
      return result.n >= minN
        ? { status: 'insufficient', n: result.n, missing, reason: messages().metrics.sameDate }
        : insufficient(result.n, missing, minN)
    }

    return {
      status: 'ok',
      n: result.n,
      missing,
      value: {
        kind: 'trend',
        slopePerWeek: result.slopePerWeek,
        intercept: result.intercept,
        originDate: result.originDate,
      },
    }
  },
})
