import type { Measure } from '../analysis/measures'
import { messages } from '../i18n'
import { addDays, daysBetween } from '../stats/subjects'
import type { Observation } from '../stats/subjects'

/**
 * Goals and the AI profile (docs/GOALS_PLAN.md). Pure functions: formats,
 * checks (used when saving, restoring backups and syncing) and progress.
 *
 * Stored as two synchronised settings: "goals.profile" and "goals.list".
 */

export const GOALS_PROFILE_KEY = 'goals.profile'
export const GOALS_LIST_KEY = 'goals.list'
export const MAX_TEXT = 5000
export const MAX_EPOCHS = 20
export const MAX_GOALS = 200

// ---------------------------------------------------------------------------
// Profile ("Set up AI"); every field optional

export interface Epoch { title: string; text: string }

export interface GoalsProfile {
  epochs: Epoch[]
  virtues: string
  faults: string
  futurePlan: string
  aiStyle: string
  aiFormat: string
}

export const EMPTY_PROFILE: GoalsProfile = { epochs: [], virtues: '', faults: '', futurePlan: '', aiStyle: '', aiFormat: '' }

const PROFILE_TEXTS = ['virtues', 'faults', 'futurePlan', 'aiStyle', 'aiFormat'] as const

function isText(value: unknown, max = MAX_TEXT): value is string {
  return typeof value === 'string' && value.length <= max
}

export function parseProfile(text: string): GoalsProfile | null {
  try {
    const value = JSON.parse(text) as Record<string, unknown>
    if (typeof value !== 'object' || value === null || !Array.isArray(value.epochs) || value.epochs.length > MAX_EPOCHS) return null
    if (!value.epochs.every((epoch) => typeof epoch === 'object' && epoch !== null && isText((epoch as Epoch).title, 200) && isText((epoch as Epoch).text))) return null
    if (!PROFILE_TEXTS.every((field) => isText(value[field]))) return null
    return {
      epochs: (value.epochs as Epoch[]).map((epoch) => ({ title: epoch.title, text: epoch.text })),
      virtues: value.virtues as string, faults: value.faults as string, futurePlan: value.futurePlan as string,
      aiStyle: value.aiStyle as string, aiFormat: value.aiFormat as string,
    }
  } catch {
    return null
  }
}

/** Trims the texts and drops empty epochs, before saving. */
export function cleanProfile(profile: GoalsProfile): GoalsProfile {
  return {
    epochs: profile.epochs.map((epoch) => ({ title: epoch.title.trim(), text: epoch.text.trim() })).filter((epoch) => epoch.title || epoch.text),
    virtues: profile.virtues.trim(), faults: profile.faults.trim(), futurePlan: profile.futurePlan.trim(),
    aiStyle: profile.aiStyle.trim(), aiFormat: profile.aiFormat.trim(),
  }
}

// ---------------------------------------------------------------------------
// Goals; every field required

export type GoalKind = 'process' | 'outcome' | 'other'
export const GOAL_KINDS: GoalKind[] = ['process', 'outcome', 'other']

/**
 * Success rules (documented convention):
 * - mean-*: the average per day (or night) over the goal's days WITH
 *   data is at least / at most the target;
 * - total-*: the sum over the goal's days (durations and numbers only);
 * - days-*: on at least `share` % of the days WITH data, the day's value
 *   is at least / at most the target.
 * Days without data are never counted as 0.
 */
export type SuccessRule = 'mean-at-least' | 'mean-at-most' | 'total-at-least' | 'total-at-most' | 'days-at-least' | 'days-at-most'
export const SUCCESS_RULES: SuccessRule[] = ['mean-at-least', 'mean-at-most', 'total-at-least', 'total-at-most', 'days-at-least', 'days-at-most']

export interface Goal {
  id: string
  title: string
  kind: GoalKind
  /** Measure id (src/analysis/measures.ts) shown to follow progress. */
  progressMeasure: string
  success: { measure: string; rule: SuccessRule; target: number; share: number | null }
  ambition: number
  realism: number
  /** UTC instants; timezone = where the goal was set (for its local dates). */
  startUtc: string
  endUtc: string
  timezone: string
  createdAt: string
  updatedAt: string
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

/**
 * A goal check that failed on a field the form explains more precisely
 * (target format, which date). The form reads `field`, never the wording,
 * so the messages can be translated.
 */
export class GoalFieldError extends Error {
  readonly field: 'target' | 'dates'

  constructor(field: 'target' | 'dates', message: string) {
    super(message)
    this.name = 'GoalFieldError'
    this.field = field
  }
}

/** Throws (with a reason) if a goal breaks the rules. */
export function validateGoal(goal: Goal): void {
  if (typeof goal.id !== 'string' || goal.id === '') throw new Error('missing id')
  if (typeof goal.title !== 'string' || goal.title.trim() === '' || goal.title.length > 500) throw new Error(messages().goalText.describe)
  if (!GOAL_KINDS.includes(goal.kind)) throw new Error(messages().goalText.chooseKind)
  if (typeof goal.progressMeasure !== 'string' || goal.progressMeasure === '') throw new Error(messages().goalText.chooseProgress)
  const success = goal.success
  if (!success || typeof success.measure !== 'string' || success.measure === '') throw new Error(messages().goalText.chooseSuccess)
  if (!SUCCESS_RULES.includes(success.rule)) throw new Error(messages().goalText.chooseRule)
  if (typeof success.target !== 'number' || !Number.isFinite(success.target)) throw new GoalFieldError('target', messages().goalText.enterTarget)
  const needsShare = success.rule.startsWith('days-')
  if (needsShare ? !(typeof success.share === 'number' && success.share > 0 && success.share <= 100) : success.share !== null) {
    throw new Error(messages().goalText.enterShare)
  }
  for (const [label, value] of [['ambition', goal.ambition], ['realism', goal.realism]] as const) {
    if (!Number.isInteger(value) || value < 1 || value > 10) throw new Error(label === 'ambition' ? messages().goalText.rateAmbition : messages().goalText.rateRealism)
  }
  if (!ISO.test(goal.startUtc) || !ISO.test(goal.endUtc)) throw new GoalFieldError('dates', messages().goalText.enterDates)
  if (goal.endUtc <= goal.startUtc) throw new Error(messages().goalText.finishAfterStart)
  if (typeof goal.timezone !== 'string' || goal.timezone === '') throw new Error('missing timezone')
  if (!ISO.test(goal.createdAt) || !ISO.test(goal.updatedAt)) throw new Error('invalid times')
}

export function parseGoals(text: string): Goal[] | null {
  try {
    const value: unknown = JSON.parse(text)
    if (!Array.isArray(value) || value.length > MAX_GOALS) return null
    for (const goal of value as Goal[]) validateGoal(goal)
    if (new Set((value as Goal[]).map((goal) => goal.id)).size !== value.length) return null
    return value as Goal[]
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Progress

/** Success measured as a total makes no sense for clock times or yes/no habits. */
export function rulesFor(kind: Measure['kind']): SuccessRule[] {
  if (kind === 'clock') return ['mean-at-least', 'mean-at-most', 'days-at-least', 'days-at-most']
  if (kind === 'binary') return ['days-at-least']
  return SUCCESS_RULES
}

export interface GoalProgress {
  status: 'not-started' | 'in-progress' | 'finished'
  daysTotal: number
  daysElapsed: number
  daysWithData: number
  /** Mean, total or share of days (%) so far; null without data. */
  value: number | null
  /** Whether the success rule is met with the data so far (null without data). */
  met: boolean | null
  /** total-* rules: the total at this pace by the finish (null otherwise or without data). */
  projected: number | null
}

/**
 * Progress of a goal on its local dates (start day to finish day,
 * inclusive) up to `today`.
 */
export function goalProgress(goal: Pick<Goal, 'success'>, period: { start: string; end: string }, daily: readonly Observation[], today: string): GoalProgress {
  const daysTotal = daysBetween(period.start, period.end) + 1
  const lastDay = today < period.end ? today : period.end
  const status = today < period.start ? 'not-started' : today > period.end ? 'finished' : 'in-progress'
  const daysElapsed = status === 'not-started' ? 0 : daysBetween(period.start, lastDay) + 1
  const values = daily
    .filter((o) => o.date >= period.start && o.date <= lastDay && typeof o.value === 'number' && Number.isFinite(o.value))
    .map((o) => o.value as number)
  const { rule, target, share } = goal.success
  if (values.length === 0) return { status, daysTotal, daysElapsed, daysWithData: 0, value: null, met: null, projected: null }

  const sum = values.reduce((total, value) => total + value, 0)
  let value: number
  let met: boolean
  let projected: number | null = null
  switch (rule) {
    case 'mean-at-least': value = sum / values.length; met = value >= target; break
    case 'mean-at-most': value = sum / values.length; met = value <= target; break
    case 'total-at-least':
    case 'total-at-most':
      value = sum
      projected = (sum / daysElapsed) * daysTotal
      met = rule === 'total-at-least' ? (status === 'finished' ? sum >= target : projected >= target) : (status === 'finished' ? sum <= target : projected <= target)
      break
    case 'days-at-least':
    case 'days-at-most': {
      const hits = values.filter((v) => (rule === 'days-at-least' ? v >= target : v <= target)).length
      value = (hits / values.length) * 100
      met = value >= (share ?? 100)
      break
    }
  }
  return { status, daysTotal, daysElapsed, daysWithData: values.length, value, met, projected }
}

/**
 * From the user's own data: on how many of the `days` days before the
 * goal starts the day reached the goal's daily level (the "data figure"
 * next to the AI's opinion, docs/GOALS_PLAN.md). For totals, the daily
 * level is the pace the total needs (target / number of goal days).
 * days = null: all data before the start. Also gives the mean of those
 * values and the first date with data. null without data.
 */
export function baselineShare(
  goal: Pick<Goal, 'success'>,
  period: { start: string; end: string },
  daily: readonly Observation[],
  days: number | null = 90,
): { share: number; n: number; level: number; mean: number; first: string } | null {
  const from = days === null ? '' : addDays(period.start, -days)
  const kept = daily.filter((o) => o.date >= from && o.date < period.start && typeof o.value === 'number' && Number.isFinite(o.value))
  if (kept.length === 0) return null
  const values = kept.map((o) => o.value as number)
  const atMost = goal.success.rule.endsWith('at-most')
  const level = goal.success.rule.startsWith('total-') ? goal.success.target / (daysBetween(period.start, period.end) + 1) : goal.success.target
  const hits = values.filter((v) => (atMost ? v <= level : v >= level)).length
  const first = kept.reduce((earliest, o) => (o.date < earliest ? o.date : earliest), kept[0].date)
  return { share: Math.round((hits / values.length) * 100), n: values.length, level, mean: values.reduce((a, b) => a + b, 0) / values.length, first }
}
