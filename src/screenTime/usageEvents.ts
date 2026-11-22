import { localDayBoundsUtc } from './screenTime'

/**
 * Screen time from Android usage events (Phase 5 step 2;
 * docs/PHASE5_PLAN.md §5). Pure functions, independent of React, the
 * database and the phone.
 *
 * Conventions (documented choices — Android does not define "screen
 * time"; Digital Wellbeing and App Usage each have their own rules):
 * - An app is on screen while at least one of its screens (activities)
 *   is resumed: from the first "activity resumed" until every resumed
 *   screen of that app is paused or stopped. Screens are tracked one by
 *   one because, when an app moves between its own screens, Android logs
 *   the old screen's "stopped" AFTER the new screen's "resumed" (pairing
 *   by app only lost 15–70% of the time in the 2026-11-11 phone test).
 * - Screen off, lock screen shown and device shutdown end every open
 *   period at that moment.
 * - A device start without a preceding shutdown (e.g. a crash) means the
 *   end of open periods is unknown: they are dropped and counted, rather
 *   than stretched up to the restart (no invented screen time).
 * - Periods still open at "now" end at "now".
 * - A period crossing midnight is split between the two local days.
 * - Totals are whole seconds (rounded from milliseconds).
 * - A day not fully covered by the available data (Android's own history
 *   plus this app's saved copy) has NO complete value: "partial" or
 *   "none" (never counted as 0).
 */

export const USAGE_EVENT = {
  ACTIVITY_RESUMED: 1,
  ACTIVITY_PAUSED: 2,
  SCREEN_INTERACTIVE: 15,
  SCREEN_NON_INTERACTIVE: 16,
  KEYGUARD_SHOWN: 17,
  KEYGUARD_HIDDEN: 18,
  ACTIVITY_STOPPED: 23,
  DEVICE_SHUTDOWN: 26,
  DEVICE_STARTUP: 27,
} as const

/**
 * Events as sent by the plugin: packages and screen (activity class)
 * names once, then [timestamp, type, package index, class index or -1].
 */
export interface UsageEventsData {
  packages: string[]
  classes?: string[]
  events: ([number, number, number] | [number, number, number, number])[]
}

/** A time span for which usage events are known to be complete. */
export interface CoveredRange {
  startMs: number
  endMs: number
}

/** Sorts and joins overlapping or touching spans. */
export function mergeRanges(ranges: readonly CoveredRange[]): CoveredRange[] {
  const sorted = ranges.filter((range) => range.endMs > range.startMs).sort((a, b) => a.startMs - b.startMs)
  const merged: CoveredRange[] = []
  for (const range of sorted) {
    const last = merged[merged.length - 1]
    if (last && range.startMs <= last.endMs) last.endMs = Math.max(last.endMs, range.endMs)
    else merged.push({ ...range })
  }
  return merged
}

/**
 * Combines usage events from several sources (Android's live history and
 * the saved copy), dropping exact duplicates (same time, type, app and
 * screen). Malformed events are kept so they are still counted as such.
 */
export function mergeUsageEvents(...sources: readonly UsageEventsData[]): UsageEventsData {
  const packages: string[] = []
  const classes: string[] = []
  const packageIndex = new Map<string, number>()
  const classIndex = new Map<string, number>()
  const seen = new Set<string>()
  const events: UsageEventsData['events'] = []

  const indexOf = (map: Map<string, number>, list: string[], value: string) => {
    let position = map.get(value)
    if (position === undefined) {
      position = list.length
      map.set(value, position)
      list.push(value)
    }
    return position
  }

  for (const source of sources) {
    const sourceClasses = source.classes ?? []
    for (const event of source.events) {
      const [ts, type, pkgIndex, clsIndex] = event as unknown[]
      const pkg = typeof pkgIndex === 'number' ? source.packages[pkgIndex] : undefined
      const cls = typeof clsIndex === 'number' && clsIndex >= 0 ? sourceClasses[clsIndex] : undefined
      if (pkg === undefined || (typeof clsIndex === 'number' && clsIndex >= 0 && cls === undefined)) {
        events.push([Number.NaN, Number(type), -1, -1]) // malformed: kept and counted later
        continue
      }
      const key = `${String(ts)}|${String(type)}|${pkg}|${cls ?? ''}`
      if (seen.has(key)) continue
      seen.add(key)
      events.push([
        ts as number,
        type as number,
        indexOf(packageIndex, packages, pkg),
        cls === undefined ? -1 : indexOf(classIndex, classes, cls),
      ])
    }
  }

  return { packages, classes, events }
}

export interface ForegroundInterval {
  pkg: string
  startMs: number
  endMs: number
}

export interface IntervalResult {
  intervals: ForegroundInterval[]
  /** Malformed events (wrong shape or unknown package), not used. */
  malformedEvents: number
  /** Open periods dropped because the phone restarted without a shutdown event. */
  droppedAtRestart: number
}

/** Turns usage events into periods during which each app was on screen. */
export function foregroundIntervals(data: UsageEventsData, nowMs: number): IntervalResult {
  let malformedEvents = 0
  const valid: { ts: number; type: number; pkg: string; screen: string; order: number }[] = []
  const classes = data.classes ?? []

  data.events.forEach((event, order) => {
    const [ts, type, index, classIndex] = (Array.isArray(event) ? event : []) as unknown[]
    if (
      typeof ts !== 'number' ||
      !Number.isFinite(ts) ||
      typeof type !== 'number' ||
      !Number.isInteger(type) ||
      typeof index !== 'number' ||
      !Number.isInteger(index) ||
      index < 0 ||
      index >= data.packages.length ||
      (classIndex !== undefined &&
        (typeof classIndex !== 'number' || !Number.isInteger(classIndex) || classIndex < -1 || classIndex >= classes.length))
    ) {
      malformedEvents += 1
      return
    }
    const screen = typeof classIndex === 'number' && classIndex >= 0 ? classes[classIndex] : ''
    valid.push({ ts, type, pkg: data.packages[index], screen, order })
  })

  // Oldest first; events with the same time keep Android's order.
  valid.sort((a, b) => a.ts - b.ts || a.order - b.order)

  // Per app: when it came on screen, and which of its screens are resumed.
  const open = new Map<string, { startMs: number; screens: Set<string> }>()
  const intervals: ForegroundInterval[] = []
  let droppedAtRestart = 0

  const close = (pkg: string, endMs: number) => {
    const period = open.get(pkg)
    if (period !== undefined) {
      if (endMs > period.startMs) intervals.push({ pkg, startMs: period.startMs, endMs })
      open.delete(pkg)
    }
  }

  for (const { ts, type, pkg, screen } of valid) {
    switch (type) {
      case USAGE_EVENT.ACTIVITY_RESUMED: {
        const period = open.get(pkg)
        if (period) period.screens.add(screen)
        else open.set(pkg, { startMs: ts, screens: new Set([screen]) })
        break
      }
      case USAGE_EVENT.ACTIVITY_PAUSED:
      case USAGE_EVENT.ACTIVITY_STOPPED: {
        const period = open.get(pkg)
        if (period) {
          period.screens.delete(screen)
          if (period.screens.size === 0) close(pkg, ts)
        }
        break
      }
      case USAGE_EVENT.SCREEN_NON_INTERACTIVE:
      case USAGE_EVENT.KEYGUARD_SHOWN:
      case USAGE_EVENT.DEVICE_SHUTDOWN:
        for (const openPkg of [...open.keys()]) close(openPkg, ts)
        break
      case USAGE_EVENT.DEVICE_STARTUP:
        droppedAtRestart += open.size
        open.clear()
        break
      default:
        break
    }
  }

  for (const pkg of [...open.keys()]) close(pkg, nowMs)

  return { intervals, malformedEvents, droppedAtRestart }
}

export type DayCoverage = 'full' | 'partial' | 'none' | 'unfinished'

export interface DayUsage {
  localDate: string
  startUtc: string
  endUtc: string
  /**
   * full: the available data covers the whole day;
   * partial: only part of the day is covered (total too low);
   * none: no data for that day (seconds is null);
   * unfinished: the day has not ended yet.
   */
  coverage: DayCoverage
  seconds: number | null
  appCount: number
  apps: { pkg: string; seconds: number }[]
}

/** The last `count` days ending with (and including) `lastDate`, oldest first. */
export function localDatesUpTo(lastDate: string, count: number): string[] {
  const [year, month, day] = lastDate.split('-').map(Number)
  return Array.from({ length: count }, (_, i) =>
    new Date(Date.UTC(year, month - 1, day - (count - 1 - i))).toISOString().slice(0, 10),
  )
}

/** Total on-screen time per local day. */
export function dailyForeground(
  intervals: readonly ForegroundInterval[],
  options: {
    localDates: readonly string[]
    timezone: string
    /** Spans for which the events are complete (any order; merged here). */
    covered: readonly CoveredRange[]
    nowMs: number
    excludePackages?: ReadonlySet<string>
  },
): DayUsage[] {
  const covered = mergeRanges(options.covered)

  return options.localDates.map((localDate) => {
    const { startUtc, endUtc } = localDayBoundsUtc(localDate, options.timezone)
    const dayStart = Date.parse(startUtc)
    const dayEnd = Date.parse(endUtc)

    let coverage: DayCoverage
    if (dayEnd > options.nowMs) coverage = 'unfinished'
    else if (covered.some((range) => range.startMs <= dayStart && range.endMs >= dayEnd)) coverage = 'full'
    else if (covered.some((range) => range.startMs < dayEnd && range.endMs > dayStart)) coverage = 'partial'
    else coverage = 'none'

    const perApp = new Map<string, number>()
    for (const interval of intervals) {
      if (options.excludePackages?.has(interval.pkg)) continue
      const overlap = Math.min(interval.endMs, dayEnd) - Math.max(interval.startMs, dayStart)
      if (overlap > 0) perApp.set(interval.pkg, (perApp.get(interval.pkg) ?? 0) + overlap)
    }

    const totalMs = [...perApp.values()].reduce((sum, ms) => sum + ms, 0)
    const apps = [...perApp.entries()]
      .map(([pkg, ms]) => ({ pkg, seconds: Math.round(ms / 1000) }))
      .sort((a, b) => b.seconds - a.seconds || a.pkg.localeCompare(b.pkg))

    return {
      localDate,
      startUtc,
      endUtc,
      coverage,
      seconds: coverage === 'none' ? null : Math.round(totalMs / 1000),
      appCount: coverage === 'none' ? 0 : apps.length,
      apps: coverage === 'none' ? [] : apps,
    }
  })
}

/**
 * Relative difference between the phone's total and a reference (e.g.
 * App Usage), in percent of the reference; null when not comparable.
 */
export function percentDifference(phoneSeconds: number | null, referenceSeconds: number | null): number | null {
  if (phoneSeconds === null || referenceSeconds === null || referenceSeconds === 0) return null
  return ((phoneSeconds - referenceSeconds) / referenceSeconds) * 100
}
