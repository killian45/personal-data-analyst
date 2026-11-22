import { cleanValues, iqr, MIN_OBSERVATIONS } from '../descriptive'
import { messages } from '../../i18n'
import { defineMetric, insufficient } from '../metric'
import { NUMERIC_SUBJECTS } from '../subjects'

/** Interquartile range: Q3 − Q1 (Hyndman–Fan type 7). */
export default defineMetric({
  id: 'iqr',
  get name() { return messages().metrics['iqr'].name },
  get description() { return messages().metrics['iqr'].description },
  category: 'descriptive',
  applicableTypes: NUMERIC_SUBJECTS,
  compute(observations, options) {
    const { values, missing } = cleanValues(observations.map((o) => o.value))
    const minN = options.minN ?? MIN_OBSERVATIONS

    if (values.length < minN || values.length === 0) {
      return insufficient(values.length, missing, minN)
    }

    return { status: 'ok', n: values.length, missing, value: { kind: 'number', value: iqr(values) } }
  },
})
