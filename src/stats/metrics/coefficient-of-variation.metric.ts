import { cleanValues, mean, MIN_OBSERVATIONS, sampleSd } from '../descriptive'
import { messages } from '../../i18n'
import { defineMetric, insufficient } from '../metric'
import { RATIO_SUBJECTS } from '../subjects'

/**
 * Coefficient of variation = sample SD ÷ mean (a fraction; 0.25 = 25 %).
 *
 * Only for ratio-scale data (amounts with a true zero). Not calculated
 * when the mean is zero or negative, or when any value is negative
 * (§8.4). Never for clock times such as bedtime.
 */
export default defineMetric({
  id: 'coefficient-of-variation',
  get name() { return messages().metrics['coefficient-of-variation'].name },
  get description() { return messages().metrics['coefficient-of-variation'].description },
  category: 'descriptive',
  applicableTypes: RATIO_SUBJECTS,
  compute(observations, options) {
    const { values, missing } = cleanValues(observations.map((o) => o.value))
    const minN = options.minN ?? MIN_OBSERVATIONS

    if (values.length < Math.max(minN, 2)) {
      return insufficient(values.length, missing, Math.max(minN, 2))
    }

    if (values.some((value) => value < 0)) {
      return { status: 'not-applicable', reason: messages().metrics.negativeValues }
    }

    const m = mean(values)

    if (m <= 0) {
      return { status: 'not-applicable', reason: messages().metrics.zeroMean }
    }

    return { status: 'ok', n: values.length, missing, value: { kind: 'number', value: sampleSd(values) / m } }
  },
})
