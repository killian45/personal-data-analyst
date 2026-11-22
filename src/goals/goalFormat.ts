import type { Measure } from '../analysis/measures'
import { formatNumber, formatValue } from '../dashboard/format'
import { messages } from '../i18n'
import { clockTargetToAxisHours } from '../settings/sleepTargets'
import type { SubjectType } from '../stats/subjects'

import type { Goal, GoalProgress, SuccessRule } from './goals'

/** Turning goal values into text and back (pure). */

export function measureSubject(measure: Pick<Measure, 'kind' | 'id'>): SubjectType {
  if (measure.kind === 'duration') return 'stopwatch'
  if (measure.kind === 'clock') return measure.id === 'sleep:wakeTime' ? 'wakeTime' : 'bedtime'
  if (measure.kind === 'binary') return 'checkbox'
  return 'number'
}

export function formatMeasureValue(measure: Pick<Measure, 'kind' | 'id' | 'unit'>, value: number): string {
  if (measure.kind === 'binary') return value >= 1 ? messages().goalText.done : messages().goalText.notDone
  return formatValue(measureSubject(measure), value, measure.unit)
}

/** What to type for a target, e.g. "7:30" or "23:00". */
export function targetHint(measure: Pick<Measure, 'kind' | 'unit'>): string {
  if (measure.kind === 'duration') return messages().goalText.hintDuration
  if (measure.kind === 'clock') return messages().goalText.hintClock
  return messages().goalText.hintNumber(measure.unit)
}

/** A typed target → the measure's value scale (hours for durations and clock times); null if not understood. */
export function parseTarget(measure: Pick<Measure, 'kind' | 'id'>, text: string): number | null {
  const value = text.trim().replace(',', '.')
  if (measure.kind === 'binary') return 1
  if (measure.kind === 'duration') {
    const match = /^(\d{1,4})(?::([0-5]\d))?$/.exec(value)
    if (match) return Number(match[1]) + Number(match[2] ?? 0) / 60
    const hours = Number(value)
    return value !== '' && Number.isFinite(hours) && hours >= 0 ? hours : null
  }
  if (measure.kind === 'clock') {
    const match = /^([01]?\d|2[0-3])[:hH.]([0-5]\d)$/.exec(value)
    return match ? clockTargetToAxisHours(`${match[1]}:${match[2]}`, measure.id === 'sleep:wakeTime' ? 'wakeTime' : 'bedtime') : null
  }
  const number = Number(value)
  return value !== '' && Number.isFinite(number) ? number : null
}

/** The target back as typed text (for editing). */
export function targetText(measure: Pick<Measure, 'kind' | 'id' | 'unit'>, target: number): string {
  if (measure.kind === 'duration') {
    const minutes = Math.round(target * 60)
    return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`
  }
  if (measure.kind === 'clock') {
    const minutes = Math.round((target % 24) * 60)
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
  }
  return String(target)
}

/* Getters: the text of the current language is read when used (sharing plan S2i). */
export const RULE_LABELS: Record<SuccessRule, string> = {
  get 'mean-at-least'() { return messages().goalText.rules['mean-at-least'] },
  get 'mean-at-most'() { return messages().goalText.rules['mean-at-most'] },
  get 'total-at-least'() { return messages().goalText.rules['total-at-least'] },
  get 'total-at-most'() { return messages().goalText.rules['total-at-most'] },
  get 'days-at-least'() { return messages().goalText.rules['days-at-least'] },
  get 'days-at-most'() { return messages().goalText.rules['days-at-most'] },
}

/** One sentence, e.g. "Sleep duration: average per day at least 7 h 30 min". */
export function describeSuccess(goal: Pick<Goal, 'success'>, measure: Pick<Measure, 'kind' | 'id' | 'unit' | 'label'>): string {
  const { rule, target, share } = goal.success
  if (measure.kind === 'binary') return messages().goalText.successDoneShare(measure.label, share ?? 100)
  const level = formatMeasureValue(measure, target)
  switch (rule) {
    case 'mean-at-least':
    case 'mean-at-most':
    case 'total-at-least':
    case 'total-at-most':
      return messages().goalText.success[rule](measure.label, level)
    case 'days-at-least':
    case 'days-at-most':
      return messages().goalText.successShare[rule](measure.label, level, share ?? 100)
  }
}

/** The progress value as text: a level (mean/total) or a share of days. */
export function formatProgressValue(goal: Pick<Goal, 'success'>, measure: Pick<Measure, 'kind' | 'id' | 'unit'>, value: number): string {
  return goal.success.rule.startsWith('days-') ? messages().goalText.shareOfDays(formatNumber(Math.round(value))) : formatMeasureValue(measure, value)
}

/** "On track", "Reached"… (goal cards and the AI chat). */
export function progressStatusText(progress: GoalProgress | null): string {
  const t = messages().goalText
  if (!progress || progress.value === null) return progress?.status === 'not-started' ? t.notStarted : t.noData
  if (progress.status === 'finished') return progress.met ? t.reached : t.notReached
  return progress.met ? t.onTrack : t.notOnTrack
}

/** The data figure as a sentence (goal cards and the AI chat). */
export function baselineText(
  goal: Pick<Goal, 'success'>,
  measure: Pick<Measure, 'kind' | 'id' | 'unit' | 'label'>,
  baseline: { share: number; n: number; level: number } | null,
): string {
  if (!baseline) return messages().goalText.noBaseline
  return messages().goalText.baseline(measure.label.toLowerCase(), goal.success.rule.endsWith('at-most'), formatMeasureValue(measure, baseline.level), baseline.share, baseline.n)
}

/**
 * The same figure over ALL data before the start, for the AI (chat and
 * opinion), e.g. "All your data before the start (since 05/12/2025): water
 * was at least 2,000 ml on 67 % of days (3 days with data); average
 * 1,766.67 ml per day."
 */
export function allTimeText(
  goal: Pick<Goal, 'success'>,
  measure: Pick<Measure, 'kind' | 'id' | 'unit' | 'label' | 'per'>,
  baseline: { share: number; n: number; level: number; mean: number; first: string },
): string {
  const t = messages().ai
  const since = baseline.first.split('-').reverse().join('/')
  const unit = measure.per === 'night' ? t.summary.night : t.summary.day
  const units = measure.per === 'night' ? t.summary.nights : t.summary.days
  const name = measure.label.toLowerCase()
  const reached = measure.kind === 'binary'
    ? t.goal.allTimeDone(name, baseline.share, baseline.n, units)
    : t.goal.allTimeLevel(name, goal.success.rule.endsWith('at-most'), formatMeasureValue(measure, baseline.level), baseline.share, baseline.n, units, formatMeasureValue(measure, baseline.mean), unit)
  return t.goal.allTime(since, reached)
}
