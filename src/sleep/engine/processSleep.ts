import { sleepSessionZone } from '../../database/sleepSessions'
import type { SleepSession } from '../../database/types'
import { offsetToZoneName } from '../../time/time'

import { axisHours, localReading, nightDateFor } from './localTime'
import { groupSleep } from './sleepDuration'
import type { SleepMethod } from './sleepDuration'

/**
 * Sleep processing engine (PROJECT_SPEC.md §7). Pure functions: no React,
 * no database. Original sessions are never modified; merged sessions and
 * nights are calculated each time.
 *
 * Steps:
 * 1. Ignore deleted sessions; exclude invalid ones (end not after start)
 *    and report them.
 * 2. Sort deterministically (start, end, id) and merge sessions that
 *    overlap or are separated by a gap STRICTLY LESS than the threshold
 *    (default 60 minutes). A gap exactly equal to the threshold does not
 *    merge.
 * 3. Classify each merged session: a nap if its elapsed duration (first
 *    start to last end) is STRICTLY LESS than 3 hours AND its local start
 *    time is from 09:00 (inclusive) to 19:00 (exclusive).
 * 4. Group the other merged sessions into nights by night date (from the
 *    merged session's local start time in its event timezone).
 * 5. Per night: bedtime = start of the first session, wake time = end of
 *    the last session, sleep duration and time in bed = sums over its
 *    sessions (see sleepDuration.ts).
 *
 * Timezones: a session's start is read in its timezone (or start UTC
 * offset); its end in its timezone (or end UTC offset, else start
 * offset). For travel, bedtime is therefore the local time where you went
 * to bed and wake time the local time where you woke up.
 */

export interface SleepEngineOptions {
  mergeGapMs: number
  napMaxDurationMs: number
  /** Nap start window in local minutes of day: [from, before). */
  napStartFromMinutes: number
  napStartBeforeMinutes: number
}

export const DEFAULT_SLEEP_ENGINE_OPTIONS: SleepEngineOptions = {
  mergeGapMs: 60 * 60 * 1000,
  napMaxDurationMs: 3 * 60 * 60 * 1000,
  napStartFromMinutes: 9 * 60,
  napStartBeforeMinutes: 19 * 60,
}

export interface MergedSleepSession {
  /** Ids of the original sessions, in time order. */
  sessionIds: string[]
  startUtc: string
  endUtc: string
  /** Timezone in which the start is read (IANA name or "+01:00"). */
  startZone: string
  /** Timezone in which the end is read. */
  endZone: string
  /** Night date (§7.2), "YYYY-MM-DD". */
  nightDate: string
  /** First start to last end, including short gaps. */
  elapsedMs: number
  timeInBedMs: number
  sleepMs: number
  method: SleepMethod
  isNap: boolean
  warnings: string[]
}

export interface Night {
  nightDate: string
  /** The night's merged sessions (naps excluded), in time order. */
  sessions: MergedSleepSession[]
  sessionIds: string[]
  bedtimeUtc: string
  wakeUtc: string
  /** Bedtime and wake time on the continuous axis (§7.7). */
  bedtimeHours: number
  wakeHours: number
  timeInBedMs: number
  sleepMs: number
  /** Methods used for the sleep duration (one per merged session). */
  methods: SleepMethod[]
  warnings: string[]
}

export interface ExcludedSession {
  sessionId: string
  reason: string
}

export interface SleepAnalysis {
  /** Nights in date order. */
  nights: Night[]
  /** Naps in time order. */
  naps: MergedSleepSession[]
  excluded: ExcludedSession[]
}

function endZone(session: SleepSession): string {
  if (session.timezone !== null) {
    return session.timezone
  }

  const offset = session.endOffsetMinutes ?? session.startOffsetMinutes
  return offset === null ? 'UTC' : offsetToZoneName(offset)
}

function byTime(a: SleepSession, b: SleepSession): number {
  return (
    a.startUtc.localeCompare(b.startUtc) ||
    a.endUtc.localeCompare(b.endUtc) ||
    a.id.localeCompare(b.id)
  )
}

/** Groups sorted sessions; gap strictly below the threshold merges. */
export function mergeSessions(sessions: SleepSession[], mergeGapMs: number): SleepSession[][] {
  const groups: SleepSession[][] = []
  let groupEnd = Number.NEGATIVE_INFINITY

  for (const session of [...sessions].sort(byTime)) {
    const start = Date.parse(session.startUtc)
    const end = Date.parse(session.endUtc)
    const current = groups.at(-1)

    if (current && start - groupEnd < mergeGapMs) {
      current.push(session)
      groupEnd = Math.max(groupEnd, end)
    } else {
      groups.push([session])
      groupEnd = end
    }
  }

  return groups
}

function describeGroup(group: SleepSession[], options: SleepEngineOptions): MergedSleepSession {
  const first = group[0]
  const last = group.reduce((latest, session) =>
    Date.parse(session.endUtc) > Date.parse(latest.endUtc) ? session : latest,
  )

  const startZone = sleepSessionZone(first)
  const elapsedMs = Date.parse(last.endUtc) - Date.parse(first.startUtc)
  const { minutesOfDay } = localReading(first.startUtc, startZone)
  const sleep = groupSleep(group)

  return {
    sessionIds: group.map((session) => session.id),
    startUtc: first.startUtc,
    endUtc: last.endUtc,
    startZone,
    endZone: endZone(last),
    nightDate: nightDateFor(first.startUtc, startZone),
    elapsedMs,
    timeInBedMs: sleep.timeInBedMs,
    sleepMs: sleep.sleepMs,
    method: sleep.method,
    isNap:
      elapsedMs < options.napMaxDurationMs &&
      minutesOfDay >= options.napStartFromMinutes &&
      minutesOfDay < options.napStartBeforeMinutes,
    warnings: sleep.warnings,
  }
}

function buildNight(nightDate: string, sessions: MergedSleepSession[]): Night {
  const first = sessions[0]
  const last = sessions[sessions.length - 1]

  return {
    nightDate,
    sessions,
    sessionIds: sessions.flatMap((session) => session.sessionIds),
    bedtimeUtc: first.startUtc,
    wakeUtc: last.endUtc,
    bedtimeHours: axisHours(first.startUtc, first.startZone, nightDate),
    wakeHours: axisHours(last.endUtc, last.endZone, nightDate),
    timeInBedMs: sessions.reduce((sum, session) => sum + session.timeInBedMs, 0),
    sleepMs: sessions.reduce((sum, session) => sum + session.sleepMs, 0),
    methods: sessions.map((session) => session.method),
    warnings: sessions.flatMap((session) => session.warnings),
  }
}

export function processSleep(
  sessions: SleepSession[],
  options: Partial<SleepEngineOptions> = {},
): SleepAnalysis {
  const settings = { ...DEFAULT_SLEEP_ENGINE_OPTIONS, ...options }
  const excluded: ExcludedSession[] = []

  const valid = sessions.filter((session) => {
    if (session.deletedAt !== null) {
      return false
    }

    const start = Date.parse(session.startUtc)
    const end = Date.parse(session.endUtc)

    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      excluded.push({ sessionId: session.id, reason: 'the session does not end after it starts' })
      return false
    }

    return true
  })

  const merged = mergeSessions(valid, settings.mergeGapMs).map((group) =>
    describeGroup(group, settings),
  )

  const naps = merged.filter((session) => session.isNap)
  const byNight = new Map<string, MergedSleepSession[]>()

  for (const session of merged) {
    if (!session.isNap) {
      byNight.set(session.nightDate, [...(byNight.get(session.nightDate) ?? []), session])
    }
  }

  const nights = [...byNight.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([nightDate, nightSessions]) => buildNight(nightDate, nightSessions))

  return { nights, naps, excluded }
}
