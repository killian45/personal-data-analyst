import { useSyncExternalStore } from 'react'

/**
 * Chart colours (dataviz reference palette, validated with the skill's
 * validate_palette.js against this app's card surfaces: white in light
 * mode and slate-900 (#0f172a) in dark mode — all checks passed).
 *
 * - series:  main data (blue, categorical slot 1)
 * - average: the 7-day moving average overlay (orange, slot 2)
 * - chrome:  gridlines, axis text and target lines use the app's slate
 *            greys; text never uses a series colour.
 * - categorical: 8 colours for several series in one chart (apps,
 *            spending categories), always in this fixed order; validated
 *            2026-11-12 on #ffffff (light: all pass; aqua, yellow and
 *            magenta under 3:1 → every such chart has a legend with names
 *            and a data table) and on #0f172a (dark: all pass). A 9th
 *            series is never a new colour: it goes into "Other".
 * - other:   neutral grey for "Other" (not a categorical slot).
 * Dark mode uses its own validated steps, not an automatic inversion.
 */

export interface ChartTheme {
  series: string
  average: string
  surface: string
  grid: string
  axis: string
  target: string
  text: string
  categorical: readonly string[]
  other: string
}

export const LIGHT_THEME: ChartTheme = {
  series: '#2a78d6',
  average: '#eb6834',
  surface: '#ffffff',
  grid: '#e2e8f0',
  axis: '#64748b',
  target: '#475569',
  text: '#0f172a',
  categorical: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'],
  other: '#94a3b8',
}

export const DARK_THEME: ChartTheme = {
  series: '#3987e5',
  average: '#d95926',
  surface: '#0f172a',
  grid: '#1e293b',
  axis: '#94a3b8',
  target: '#cbd5e1',
  text: '#f1f5f9',
  categorical: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],
  other: '#64748b',
}

const QUERY = '(prefers-color-scheme: dark)'

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => {}
  }

  const media = window.matchMedia(QUERY)
  media.addEventListener('change', onChange)
  return () => media.removeEventListener('change', onChange)
}

function isDark(): boolean {
  return typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia(QUERY).matches
}

/** The chart theme matching the system light/dark preference. */
export function useChartTheme(): ChartTheme {
  return useSyncExternalStore(subscribe, isDark, () => false) ? DARK_THEME : LIGHT_THEME
}

/** Axis ticks for hours: the smallest step giving at most 5 intervals. Pure. */
export function durationTicks(maxHours: number): number[] {
  const step = [0.25, 0.5, 1, 2, 4, 6, 12, 24].find((candidate) => maxHours / candidate <= 5) ?? Math.ceil(maxHours / 5)
  const top = Math.max(step, Math.ceil(maxHours / step) * step)
  return Array.from({ length: Math.round(top / step) + 1 }, (_, index) => index * step)
}

/** The colour of a series in the current light/dark theme. */
export function useSeriesColor(): (slot: number | 'other') => string {
  const theme = useChartTheme()
  return (slot) => (slot === 'other' ? theme.other : theme.categorical[slot % theme.categorical.length])
}
