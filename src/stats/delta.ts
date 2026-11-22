import { cleanValues, mean, MIN_OBSERVATIONS } from './descriptive'
import { addDays, daysBetween, SUBJECT_SCALES } from './subjects'
import type { SubjectType } from './subjects'

/**
 * Change versus the previous period of equal length (§8.1, §8.4).
 */

export interface DateRange {
  /** Inclusive local dates "YYYY-MM-DD". */
  start: string
  end: string
}

/** The period of the same number of days immediately before `range`. */
export function previousPeriod(range: DateRange): DateRange {
  const length = daysBetween(range.start, range.end) + 1

  if (length < 1) {
    throw new Error('The range must end on or after its start.')
  }

  return { start: addDays(range.start, -length), end: addDays(range.start, -1) }
}

export interface DeltaResult {
  /** Insufficient when either period has fewer than 5 observations. */
  insufficient: boolean
  currentN: number
  previousN: number
  currentMean: number | null
  previousMean: number | null
  /** current mean − previous mean, in the subject's unit. */
  absolute: number | null
  /**
   * Relative change in percent, only for ratio-scale subjects whose
   * values are all ≥ 0 and whose previous mean is > 0. Never for clock
   * times such as bedtime (absolute change only).
   */
  percent: number | null
}

export function deltaVersusPrevious(
  subject: SubjectType,
  current: ReadonlyArray<number | null>,
  previous: ReadonlyArray<number | null>,
  minN: number = MIN_OBSERVATIONS,
): DeltaResult {
  const a = cleanValues(current).values
  const b = cleanValues(previous).values

  if (a.length < minN || b.length < minN || a.length === 0 || b.length === 0) {
    return {
      insufficient: true,
      currentN: a.length,
      previousN: b.length,
      currentMean: null,
      previousMean: null,
      absolute: null,
      percent: null,
    }
  }

  const currentMean = mean(a)
  const previousMean = mean(b)
  const percentAllowed =
    SUBJECT_SCALES[subject] === 'ratio' &&
    previousMean > 0 &&
    [...a, ...b].every((value) => value >= 0)

  return {
    insufficient: false,
    currentN: a.length,
    previousN: b.length,
    currentMean,
    previousMean,
    absolute: currentMean - previousMean,
    percent: percentAllowed ? ((currentMean - previousMean) / previousMean) * 100 : null,
  }
}
