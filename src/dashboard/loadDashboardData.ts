import { db } from '../database/db'
import type { Entry, ExternalSample, Habit } from '../database/types'
import type { LocationMeasure } from '../location/dailyLocation'
import { LOCATION_TYPES } from '../location/location'
import { SCREEN_TIME_DAILY } from '../screenTime/screenTime'
import { loadAwayPlace, loadLocationMeasure, loadPlaceNames } from '../settings/dashboardLocation'
import { loadFormulas } from '../formulas/formulas'
import type { FormulaDefinition } from '../formulas/formulas'
import { loadMetricSelection } from '../settings/dashboardMetrics'
import type { MetricSelection } from '../settings/dashboardMetrics'
import { loadSectionOrder } from '../settings/dashboardOrder'
import { loadHiddenSections } from '../settings/dashboardHidden'
import { loadChosenApps } from '../settings/dashboardScreenTimeApps'
import type { ChosenAppSlots } from '../settings/dashboardScreenTimeApps'
import { loadChosenCategories } from '../settings/dashboardYnabCategories'
import { HEALTH_MEASUREMENT_TYPES } from '../healthData/healthData'
import { YNAB_MEASUREMENT } from '../ynab/ynabRecord'
import { loadDisplayTimezone } from '../settings/displayTimezone'
import type { DisplayTimezone } from '../settings/displayTimezone'
import { loadSleepTargets } from '../settings/sleepTargets'
import type { SleepTargets } from '../settings/sleepTargets'
import { processSleep } from '../sleep/engine/processSleep'
import type { SleepAnalysis } from '../sleep/engine/processSleep'

/**
 * Everything the dashboard needs, read in one go. Deleted records are
 * excluded; archived habits are not shown on the dashboard.
 */
export interface DashboardData {
  habits: Habit[]
  entries: Entry[]
  sleep: SleepAnalysis
  /** Non-deleted screen-time days (every source). */
  screenTime: ExternalSample[]
  /** Non-deleted location visits and movements. */
  location: ExternalSample[]
  /** The view chosen in the Location section. */
  locationMeasure: LocationMeasure
  /** The place chosen for "Time away from…" (key; "home" by default). */
  awayPlace: string
  /** Names the user gave to places, by place key. */
  placeNames: Record<string, string>
  /** The user's custom measures ("My formulas"). */
  formulas: FormulaDefinition[]
  displayTimezone: DisplayTimezone
  targets: SleepTargets
  metricSelection: MetricSelection
  /** Saved section order (null: default order). */
  sectionOrder: string[] | null
  /** Panels the user hid (section ids). */
  hiddenSections: string[]
  /** Apps chosen for the screen-time panel, by colour slot (empty: total). */
  screenTimeApps: ChosenAppSlots
  /** Health Connect activity and heart data (docs/HEALTH_DATA_PLAN.md). */
  health: ExternalSample[]
  /** YNAB transactions (docs/YNAB_PLAN.md). */
  ynab: ExternalSample[]
  /** Spending categories chosen for the YNAB panel, by colour slot (empty: all). */
  ynabCategories: ChosenAppSlots
}

/** Non-deleted external samples of the given measurement types. */
async function liveSamples(types: readonly string[]): Promise<ExternalSample[]> {
  const samples = await db.externalSamples.where('measurementType').anyOf([...types]).toArray()
  return samples.filter((sample) => sample.deletedAt === null)
}

/**
 * The stored records, read in one transaction so they are consistent with
 * each other. Named fields (not a positional list): several results share
 * a type, so a reordering would otherwise go unnoticed by the compiler.
 */
async function loadRecords() {
  return db.transaction('r', [db.habits, db.entries, db.sleepSessions, db.externalSamples], async () => {
    const habits = (await db.habits.toArray())
      .filter((habit) => habit.deletedAt === null && !habit.archived)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    const entries = (await db.entries.toArray()).filter((entry) => entry.deletedAt === null)
    const sessions = (await db.sleepSessions.toArray()).filter((session) => session.deletedAt === null)
    return {
      habits,
      entries,
      sessions,
      screenTime: await liveSamples([SCREEN_TIME_DAILY]),
      location: await liveSamples(LOCATION_TYPES),
      health: await liveSamples(HEALTH_MEASUREMENT_TYPES),
      ynab: await liveSamples([YNAB_MEASUREMENT]),
    }
  })
}

/** Awaits named promises in parallel; each result keeps its name. */
async function allNamed<T extends Record<string, Promise<unknown>>>(
  promises: T,
): Promise<{ [K in keyof T]: Awaited<T[K]> }> {
  const pairs = await Promise.all(Object.entries(promises).map(async ([key, promise]) => [key, await promise] as const))
  return Object.fromEntries(pairs) as { [K in keyof T]: Awaited<T[K]> }
}

/** The user's dashboard settings, read in parallel. */
function loadSettings() {
  return allNamed({
    displayTimezone: loadDisplayTimezone(),
    targets: loadSleepTargets(),
    metricSelection: loadMetricSelection(),
    sectionOrder: loadSectionOrder(),
    locationMeasure: loadLocationMeasure(),
    awayPlace: loadAwayPlace(),
    placeNames: loadPlaceNames(),
    formulas: loadFormulas(),
    hiddenSections: loadHiddenSections(),
    screenTimeApps: loadChosenApps(),
    ynabCategories: loadChosenCategories(),
  })
}

export async function loadDashboardData(): Promise<DashboardData> {
  const { sessions, ...records } = await loadRecords()
  const settings = await loadSettings()
  return { ...records, ...settings, sleep: processSleep(sessions) }
}
