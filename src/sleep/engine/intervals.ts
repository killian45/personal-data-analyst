/**
 * Time intervals in milliseconds since 1970 (UTC), half-open [start, end).
 * Pure helpers used by the sleep engine.
 */

export interface Interval {
  start: number
  end: number
}

/** Merges overlapping or touching intervals; result is sorted. */
export function unionIntervals(intervals: Interval[]): Interval[] {
  const sorted = intervals
    .filter((interval) => interval.end > interval.start)
    .map((interval) => ({ ...interval }))
    .sort((a, b) => a.start - b.start || a.end - b.end)

  const result: Interval[] = []

  for (const interval of sorted) {
    const last = result.at(-1)

    if (last && interval.start <= last.end) {
      last.end = Math.max(last.end, interval.end)
    } else {
      result.push(interval)
    }
  }

  return result
}

/** Total length of the union of the intervals (overlaps counted once). */
export function totalLength(intervals: Interval[]): number {
  return unionIntervals(intervals).reduce((sum, interval) => sum + interval.end - interval.start, 0)
}

/** The parts of `from` not covered by `remove`. */
export function subtractIntervals(from: Interval[], remove: Interval[]): Interval[] {
  const removals = unionIntervals(remove)
  const result: Interval[] = []

  for (const interval of unionIntervals(from)) {
    let cursor = interval.start

    for (const removal of removals) {
      if (removal.end <= cursor || removal.start >= interval.end) {
        continue
      }

      if (removal.start > cursor) {
        result.push({ start: cursor, end: removal.start })
      }

      cursor = Math.max(cursor, removal.end)
    }

    if (cursor < interval.end) {
      result.push({ start: cursor, end: interval.end })
    }
  }

  return result
}

/** Limits an interval to [min, max); null if nothing remains. */
export function clipInterval(interval: Interval, min: number, max: number): Interval | null {
  const start = Math.max(interval.start, min)
  const end = Math.min(interval.end, max)

  return end > start ? { start, end } : null
}
