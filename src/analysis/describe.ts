import { describeStrength } from '../stats/correlation'
import type { CorrelationResult } from '../stats/correlation'
import { messages } from '../i18n'

import type { Measure } from './measures'

/**
 * Plain-language reading of a correlation (Phase 6 step 2). Pure.
 * Wording rules:
 * - "higher" for amounts, "later" for clock times (bedtime, wake time),
 *   "done" for checkboxes;
 * - the delay in words, using the night-date convention for sleep;
 * - always says what the result does NOT show.
 */

function more(measure: Measure): string {
  if (measure.kind === 'clock') return messages().correlationText.later
  return messages().correlationText.higher
}

function less(measure: Measure): string {
  if (measure.kind === 'clock') return messages().correlationText.earlier
  return messages().correlationText.lower
}

function subject(measure: Measure, higher: boolean): string {
  if (measure.kind === 'binary') return higher ? messages().correlationText.isDone(measure.label) : messages().correlationText.isNotDone(measure.label)
  return messages().correlationText.is(measure.label, higher ? more(measure) : less(measure))
}

/** When Y is measured relative to X, in words. */
export function delayWords(x: Measure, y: Measure, lag: number): string {
  const ySleep = y.per === 'night'
  const xSleep = x.per === 'night'
  if (lag === 0) {
    if (ySleep && !xSleep) return messages().correlationText.nightThatEvening
    if (xSleep && !ySleep) return messages().correlationText.dayNightStarted
    return messages().correlationText.sameDay
  }
  if (lag === 1) {
    if (xSleep && !ySleep) return messages().correlationText.nextDayAfterWaking
    return ySleep ? messages().correlationText.nextNight : messages().correlationText.nextDay
  }
  return ySleep ? messages().correlationText.nightsLater(lag) : messages().correlationText.daysLater(lag)
}

export function delayLabel(lag: number): string {
  return lag === 0 ? messages().correlationText.sameDayLabel : lag === 1 ? messages().correlationText.oneDayLater : messages().correlationText.daysLater(lag)
}

function round2(value: number): string {
  return value.toFixed(2).replace('-', '−')
}

/** One or two sentences describing the result. */
export function readCorrelation(result: CorrelationResult, x: Measure, y: Measure): string {
  if (result.status === 'too-few-days') {
    return messages().correlationText.tooFewDays(result.n)
  }
  if (result.status === 'no-variation') {
    return messages().correlationText.noVariation
  }
  const r = result.pearson!.value
  const when = delayWords(x, y, result.lag)
  if (result.status === 'too-dependent') {
    return messages().correlationText.tooDependent(round2(r), result.n, Math.max(0, Math.round(result.nEffective ?? 0)))
  }
  const strength = describeStrength(r)
  if (strength === 'negligible') {
    return messages().correlationText.noRelation(subject(x, true), y.label, when, round2(r))
  }
  const direction = r > 0
  const outcome = y.kind === 'binary'
    ? (direction ? messages().correlationText.tendsDone(y.label) : messages().correlationText.tendsNotDone(y.label))
    : messages().correlationText.tendsTo(y.label, when, direction ? more(y) : less(y))
  return messages().correlationText.relation(subject(x, true), outcome, messages().correlationText.strengths[strength], round2(r), round2(result.pearson!.low!), round2(result.pearson!.high!))
}

/** The always-visible warnings (spec §13 safeguards), plus data-specific ones. */
export function correlationWarnings(result: CorrelationResult, x: Measure, y: Measure): string[] {
  const warnings = [
    messages().correlationText.warningCause,
    messages().correlationText.warningOnePerson,
  ]
  if (result.status === 'ok' && result.n < 30) warnings.push(messages().correlationText.warningSmall(result.n))
  if (result.nEffective !== null && result.nEffective < result.n - 0.5) {
    warnings.push(messages().correlationText.warningDependent(result.n, Math.round(result.nEffective)))
  }
  if (x.kind === 'clock' || y.kind === 'clock') warnings.push(messages().correlationText.warningClock)
  return warnings
}
