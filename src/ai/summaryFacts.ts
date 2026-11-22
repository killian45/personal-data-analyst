import { formatMeasureValue } from '../analysis/format'
import type { Measure } from '../analysis/measures'
import { inRange } from '../dashboard/periods'
import { deltaVersusPrevious, previousPeriod } from '../stats/delta'
import type { DateRange } from '../stats/delta'
import { describe } from '../stats/descriptive'
import { daysBetween } from '../stats/subjects'
import type { SubjectType } from '../stats/subjects'
import { messages } from '../i18n'
import { formatDuration } from '../stopwatch/duration'

/**
 * What the local AI receives for a summary (Phase 6 step 5): one vetted
 * sentence per measure, built by the app from the same statistics as the
 * Dashboard (mean over the range, change versus the previous period of
 * equal length). Aggregated numbers only — never records. Pure.
 *
 * Included: sleep, habits (number, stopwatch, checkbox), screen time,
 * location distance / active travel / places visited / time away from
 * home, and formulas; measures with fewer than 5 values in the range are
 * left out (as on the Dashboard, "insufficient data").
 */

const SUBJECT: Record<Measure['kind'], SubjectType> = { duration: 'stopwatch', clock: 'bedtime', number: 'number', binary: 'checkbox' }
const LOCATION_INCLUDED = new Set(['location:distance', 'location:active', 'location:places', 'location:away:home'])

function dmy(date: string): string {
  return date.split('-').reverse().join('/')
}

function changeText(measure: Measure, change: number): string {
  const t = messages().ai.summary
  const up = change > 0
  if (measure.kind === 'clock' || measure.kind === 'duration') {
    const minutes = Math.round(Math.abs(change) * 60)
    if (minutes === 0) return t.same
    const amount = minutes < 60 ? `${minutes} min` : formatDuration(minutes * 60_000)
    if (measure.kind === 'clock') return up ? t.later(amount) : t.earlier(amount)
    return up ? t.more(amount) : t.less(amount)
  }
  const amount = formatMeasureValue(measure, Math.abs(change))
  if (amount.startsWith('0 ') || amount === '0') return t.same
  return up ? t.more(amount) : t.less(amount)
}

export interface SummaryFacts {
  facts: string[]
  /** Measures used (for the "numbers given" table). */
  included: string[]
}

export function buildSummaryFacts(measures: readonly Measure[], range: DateRange): SummaryFacts {
  const t = messages().ai.summary
  const facts = [t.period(dmy(range.start), dmy(range.end), daysBetween(range.start, range.end) + 1)]
  const included: string[] = []
  const previous = previousPeriod(range)

  for (const measure of measures) {
    if (measure.id.startsWith('location:') && !LOCATION_INCLUDED.has(measure.id)) continue
    const current = inRange(measure.daily, range).map((o) => o.value)
    const summary = describe(current)
    if (summary.insufficient || summary.mean === null) continue
    const unit = measure.per === 'night' ? t.night : t.day
    const units = measure.per === 'night' ? t.nights : t.days
    const delta = deltaVersusPrevious(SUBJECT[measure.kind], current, inRange(measure.daily, previous).map((o) => o.value))

    let sentence: string
    if (measure.kind === 'binary') {
      const done = current.filter((value) => value === 1).length
      const now = Math.round((done / summary.n) * 100)
      sentence = t.doneOn(measure.label, done, summary.n, units, now)
      if (!delta.insufficient && delta.previousMean !== null) {
        // The comparison is written out so the model has nothing to calculate.
        const before = Math.round(delta.previousMean * 100)
        sentence += before === now ? t.sameShare : before < now ? t.upFrom(before) : t.downFrom(before)
      } else {
        sentence += t.noComparison
      }
    } else {
      sentence = t.average(measure.label, formatMeasureValue(measure, summary.mean), unit, summary.n, units)
      sentence += delta.insufficient || delta.absolute === null
        ? t.noComparison
        : `, ${changeText(measure, delta.absolute)}`
    }
    facts.push(`${sentence}.`)
    included.push(measure.label)
  }
  return { facts, included }
}

/** Instructions for the local model, in the app's language (tested 2026-11-12, see docs/PHASE6_PLAN.md). */
export function summaryInstructions(): string {
  return messages().ai.summary.instructions
}

/** The message with the facts. */
export function summaryPrompt(facts: readonly string[]): string {
  return messages().ai.summary.prompt(facts.map((fact) => `- ${fact}`).join('\n'))
}
