import type { SleepSession, SleepStageType } from '../../database/types'

import { clipInterval, subtractIntervals, totalLength, unionIntervals } from './intervals'
import type { Interval } from './intervals'

/**
 * Sleep duration of a group of overlapping/adjacent original sessions
 * (one merged session). PROJECT_SPEC.md §7.4 priority order:
 *
 * 1. Validated sleep-stage intervals, when available.
 * 2. Valid reported total sleep duration, when available.
 * 3. Elapsed session duration as fallback.
 *
 * Stage rules:
 * - Sleep stages: sleeping, light, deep, rem.
 *   Wake stages:  awake, awake_in_bed, out_of_bed.
 *   "unknown" counts as neither.
 * - A stage whose end is not after its start is invalid and excluded.
 * - A stage partly outside its session is clipped to the session; a stage
 *   entirely outside it is invalid and excluded.
 * - Overlapping stages are never counted twice (union). Where a wake stage
 *   overlaps a sleep stage, the time counts as awake (cautious choice).
 * - Stages are "available" for a session when at least one valid stage of
 *   a known type (not "unknown") remains.
 *
 * Reported total: valid when it is a finite number greater than 0 and not
 * longer than the session's elapsed duration.
 *
 * Combining several original sessions in one merged session:
 * - If any session has available stages, the duration is the union of
 *   their sleep stages minus their wake stages. Sessions without stages
 *   are then ignored for the sleep duration (noted in the warnings).
 * - Otherwise, if every session has a valid reported total and they do
 *   not overlap each other, the reported totals are added.
 * - Otherwise, the elapsed fallback is the union of the sessions'
 *   intervals (overlaps counted once; gaps between sessions excluded).
 *
 * Time in bed (§7.5) is always the union of the sessions' intervals.
 */

export type SleepMethod = 'stages' | 'reported' | 'elapsed'

const SLEEP_STAGES: ReadonlySet<SleepStageType> = new Set(['sleeping', 'light', 'deep', 'rem'])
const WAKE_STAGES: ReadonlySet<SleepStageType> = new Set(['awake', 'awake_in_bed', 'out_of_bed'])

export interface GroupSleep {
  sleepMs: number
  timeInBedMs: number
  method: SleepMethod
  /** Plain-language notes about excluded or ignored data. */
  warnings: string[]
}

function sessionInterval(session: SleepSession): Interval {
  return { start: Date.parse(session.startUtc), end: Date.parse(session.endUtc) }
}

interface UsableStages {
  sleep: Interval[]
  wake: Interval[]
  invalidCount: number
}

/** Valid, clipped stage intervals of one session. */
export function usableStages(session: SleepSession): UsableStages {
  const bounds = sessionInterval(session)
  const result: UsableStages = { sleep: [], wake: [], invalidCount: 0 }

  for (const stage of session.stages) {
    const raw = { start: Date.parse(stage.start), end: Date.parse(stage.end) }
    const clipped = raw.end > raw.start ? clipInterval(raw, bounds.start, bounds.end) : null

    if (!clipped) {
      result.invalidCount += 1
    } else if (SLEEP_STAGES.has(stage.stage)) {
      result.sleep.push(clipped)
    } else if (WAKE_STAGES.has(stage.stage)) {
      result.wake.push(clipped)
    }
  }

  return result
}

function hasAvailableStages(stages: UsableStages): boolean {
  return stages.sleep.length > 0 || stages.wake.length > 0
}

/** True when the reported total is usable for this session. */
export function isValidReportedSleep(session: SleepSession): boolean {
  const value = session.reportedSleepMs
  const elapsed = Date.parse(session.endUtc) - Date.parse(session.startUtc)

  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= elapsed
}

function overlapEachOther(sessions: SleepSession[]): boolean {
  const intervals = sessions.map(sessionInterval).sort((a, b) => a.start - b.start)
  return intervals.some((interval, index) => index > 0 && interval.start < intervals[index - 1].end)
}

export function groupSleep(sessions: SleepSession[]): GroupSleep {
  const warnings: string[] = []
  const timeInBedMs = totalLength(sessions.map(sessionInterval))

  const stagesBySession = sessions.map((session) => ({ session, stages: usableStages(session) }))
  const invalidStages = stagesBySession.reduce((sum, item) => sum + item.stages.invalidCount, 0)

  if (invalidStages > 0) {
    warnings.push(`${invalidStages} invalid sleep stage interval(s) excluded.`)
  }

  const staged = stagesBySession.filter((item) => hasAvailableStages(item.stages))

  if (staged.length > 0) {
    if (staged.length < sessions.length) {
      warnings.push(
        `${sessions.length - staged.length} session(s) without sleep stages ignored for the sleep duration.`,
      )
    }

    const sleep = unionIntervals(staged.flatMap((item) => item.stages.sleep))
    const wake = unionIntervals(staged.flatMap((item) => item.stages.wake))

    return {
      sleepMs: totalLength(subtractIntervals(sleep, wake)),
      timeInBedMs,
      method: 'stages',
      warnings,
    }
  }

  const invalidReported = sessions.filter(
    (session) => session.reportedSleepMs !== null && !isValidReportedSleep(session),
  )

  if (invalidReported.length > 0) {
    warnings.push(`${invalidReported.length} invalid reported sleep duration(s) ignored.`)
  }

  if (sessions.every(isValidReportedSleep) && !overlapEachOther(sessions)) {
    return {
      sleepMs: sessions.reduce((sum, session) => sum + (session.reportedSleepMs ?? 0), 0),
      timeInBedMs,
      method: 'reported',
      warnings,
    }
  }

  return { sleepMs: timeInBedMs, timeInBedMs, method: 'elapsed', warnings }
}
