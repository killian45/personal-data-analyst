import type { ExternalSample } from '../database/types'
import type { Observation } from '../stats/subjects'

import { EXERCISE_MEASUREMENT, HEALTH_MEASUREMENTS } from './healthData'
import type { HealthKind } from './healthData'

/**
 * Daily values for the Dashboard (docs/HEALTH_DATA_PLAN.md).
 *
 * Several source apps may write the same kind (e.g. phone and watch);
 * adding them would count steps twice. ONE source is used per kind: the
 * one with the most days in the shown dates (ties: alphabetical). Days
 * without a record are missing, never 0.
 */

export interface HealthSeries {
  daily: Observation[]
  /** The source app used, or null when there is no data. */
  origin: string | null
  /** Every source app that has this kind in the shown dates. */
  origins: string[]
}

const dateOf = (sample: ExternalSample) => String((sample.metadata as { localDate?: unknown } | null)?.localDate)

/** Values per day for one kind; distance in kilometres, others in their own unit. */
export function healthSeries(samples: readonly ExternalSample[], kind: HealthKind, range?: { start: string; end: string }): HealthSeries {
  const ofKind = samples.filter((sample) => sample.deletedAt === null && sample.measurementType === HEALTH_MEASUREMENTS[kind])
  const inRange = range ? ofKind.filter((sample) => dateOf(sample) >= range.start && dateOf(sample) <= range.end) : ofKind
  const days = new Map<string, number>()
  for (const sample of inRange) days.set(sample.sourceApp ?? 'unknown', (days.get(sample.sourceApp ?? 'unknown') ?? 0) + 1)
  const origins = [...days.keys()].sort((a, b) => (days.get(b) ?? 0) - (days.get(a) ?? 0) || a.localeCompare(b))
  const origin = origins[0] ?? null
  const factor = kind === 'distance' ? 1 / 1000 : 1
  const daily = ofKind
    .filter((sample) => (sample.sourceApp ?? 'unknown') === origin)
    .map((sample) => ({ date: dateOf(sample), value: sample.value * factor }))
    .sort((a, b) => a.date.localeCompare(b.date))
  return { daily, origin, origins: [...origins].sort() }
}

export interface ExerciseSummary {
  /** Hours of exercise per day, on days with at least one session. */
  daily: Observation[]
  sessions: number
  /** Total seconds per exercise name, most first. */
  byType: { name: string; seconds: number; sessions: number }[]
}

export function exerciseSummary(samples: readonly ExternalSample[], range?: { start: string; end: string }): ExerciseSummary {
  const sessions = samples.filter((sample) => sample.deletedAt === null && sample.measurementType === EXERCISE_MEASUREMENT)
  const perDay = new Map<string, number>()
  for (const session of sessions) perDay.set(dateOf(session), (perDay.get(dateOf(session)) ?? 0) + session.value)
  const shown = range ? sessions.filter((s) => dateOf(s) >= range.start && dateOf(s) <= range.end) : sessions
  const types = new Map<string, { name: string; seconds: number; sessions: number }>()
  for (const session of shown) {
    const name = String((session.metadata as { exerciseName?: unknown } | null)?.exerciseName ?? 'Exercise')
    const entry = types.get(name) ?? { name, seconds: 0, sessions: 0 }
    entry.seconds += session.value
    entry.sessions += 1
    types.set(name, entry)
  }
  return {
    daily: [...perDay.entries()].map(([date, seconds]) => ({ date, value: seconds / 3600 })).sort((a, b) => a.date.localeCompare(b.date)),
    sessions: shown.length,
    byType: [...types.values()].sort((a, b) => b.seconds - a.seconds || a.name.localeCompare(b.name)),
  }
}
