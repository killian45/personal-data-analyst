import type { Observation } from '../subjects'

/** Turns values into daily observations from 1 November 2026. */
export function daily(values: (number | null)[]): Observation[] {
  return values.map((value, index) => ({
    date: new Date(Date.UTC(2026, 10, 1 + index)).toISOString().slice(0, 10),
    value,
  }))
}

/** Hand-calculated set (sorted 2 4 4 4 5 5 7 9): see descriptive.test.ts. */
export const REFERENCE = [5, 2, 4, 7, 4, 9, 4, 5]
