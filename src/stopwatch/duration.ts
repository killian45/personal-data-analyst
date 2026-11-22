import { elapsedMilliseconds } from '../time/time'

import type {
  ActiveTimer,
  StopwatchSegment,
} from '../database/types'

/**
 * Stopwatch duration rules:
 *
 * - The active duration is the sum of the active periods (segments).
 * - Pauses (gaps between segments) never count.
 * - Each segment's length is the actual time between its two UTC
 *   instants, so daylight-saving changes and travel are handled.
 */

/** Total active time of completed segments, in milliseconds. */
export function activeDurationMs(segments: StopwatchSegment[]): number {
  return segments.reduce(
    (total, segment) =>
      total + elapsedMilliseconds(segment.start, segment.end),
    0,
  )
}

/**
 * Active time of a running or paused stopwatch at a given moment,
 * in milliseconds. A running period never counts as negative time
 * (e.g. if the device clock is behind its start).
 */
export function timerElapsedMs(
  timer: Pick<ActiveTimer, 'completedSegments' | 'runningSince'>,
  nowMs: number,
): number {
  const completed = activeDurationMs(timer.completedSegments)

  if (timer.runningSince === null) {
    return completed
  }

  return completed + Math.max(0, nowMs - Date.parse(timer.runningSince))
}

/**
 * Formats a duration for display, rounded down to whole minutes:
 * "0 min" (exactly nothing, e.g. an app not used on a recorded day),
 * "less than 1 min", "45 min", "1 h 05 min", "26 h 10 min".
 */
export function formatDuration(ms: number): string {
  if (!(ms > 0)) {
    return '0 min'
  }

  const totalMinutes = Math.floor(ms / 60_000)

  if (totalMinutes === 0) {
    return 'less than 1 min'
  }

  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60

  if (hours === 0) {
    return `${minutes} min`
  }

  return `${hours} h ${String(minutes).padStart(2, '0')} min`
}
