import { cleanValues, median, MIN_OBSERVATIONS } from '../descriptive'
import { messages } from '../../i18n'
import { defineMetric, insufficient } from '../metric'
import { NUMERIC_SUBJECTS } from '../subjects'

/** Median (Hyndman–Fan type 7 at p = 0.5). */
export default defineMetric({
  id: 'median',
  get name() { return messages().metrics['median'].name },
  get description() { return messages().metrics['median'].description },
  category: 'descriptive',
  applicableTypes: NUMERIC_SUBJECTS,
  compute(observations, options) {
    const { values, missing } = cleanValues(observations.map((o) => o.value))
    const minN = options.minN ?? MIN_OBSERVATIONS

    if (values.length < minN || values.length === 0) {
      return insufficient(values.length, missing, minN)
    }

    return { status: 'ok', n: values.length, missing, value: { kind: 'number', value: median(values) } }
  },
})
