import type { DashboardData } from '../dashboard/loadDashboardData'
import { formulaDaily } from '../formulas/display'
import { messages } from '../i18n'
import { isFeatureOn } from '../settings/features'
import { habitDailyObservations, sleepObservations } from '../dashboard/observations'
import { awayFromSeries, HOME_PLACE_KEY, listPlaces, locationSeries, timeInSeries } from '../location/dailyLocation'
import { placeLabel } from '../location/places'
import { screenTimeObservations } from '../screenTime/dailyScreenTime'
import type { Observation } from '../stats/subjects'
import { exerciseSummary, healthSeries } from '../healthData/healthDaily'
import { spendingSummary } from '../ynab/ynabDaily'

/**
 * Every daily measure that can be compared on the Analysis page (Phase 6
 * step 2). Pure function: the values are the same daily series as on the
 * Dashboard (one value per day or night; missing days absent, never 0).
 *
 * Dates: habits, screen time and location use their own day; sleep uses
 * the night date (§7.2: the evening the night starts). So "X on day d vs
 * sleep on day d" means "X that day vs the night starting that evening".
 *
 * Location places: "time in" for Home, named places and places visited on
 * at least 3 days (others have too few days to compare), and "time away
 * from home".
 */

export type MeasureKind = 'duration' | 'clock' | 'number' | 'binary'

export interface Measure {
  id: string
  label: string
  /** Display name of the group (translated; never used as a key). */
  group: string
  kind: MeasureKind
  /** Unit for numbers (e.g. "km", "ml"), null otherwise. */
  unit: string | null
  /** "night" for sleep measures (dated by the evening), else "day". */
  per: 'night' | 'day'
  daily: Observation[]
}

const MIN_PLACE_DAYS = 3

/**
 * All measures; with `formulas`, the user's formulas are added last
 * (group "My formulas") when every measure they use exists.
 */
export function buildMeasures(
  data: Pick<DashboardData, 'habits' | 'entries' | 'sleep' | 'screenTime' | 'location' | 'placeNames' | 'displayTimezone'> &
    Partial<Pick<DashboardData, 'formulas' | 'health' | 'ynab'>>,
  /** Last day for spending (a day without spending counts as 0 up to it); default: the last transaction day. */
  today?: string,
): Measure[] {
  const measures: Measure[] = []
  const sleep = sleepObservations(data.sleep.nights)
  const sleepMeasure = (id: string, label: string, kind: MeasureKind, daily: Observation[]) =>
    measures.push({ id: `sleep:${id}`, label, group: messages().measures.groups.sleep, kind, unit: null, per: 'night', daily })
  sleepMeasure('duration', messages().measures.sleepDuration, 'duration', sleep.sleepDuration)
  sleepMeasure('timeInBed', messages().measures.timeInBed, 'duration', sleep.timeInBed)
  sleepMeasure('bedtime', messages().measures.bedtime, 'clock', sleep.bedtime)
  sleepMeasure('wakeTime', messages().measures.wakeTime, 'clock', sleep.wakeTime)

  for (const habit of data.habits) {
    if (habit.type === 'label' || habit.type === 'text') continue
    measures.push({
      id: `habit:${habit.id}`,
      label: habit.name,
      group: messages().measures.groups.habits,
      kind: habit.type === 'stopwatch' ? 'duration' : habit.type === 'checkbox' ? 'binary' : 'number',
      unit: habit.type === 'number' ? habit.unit : null,
      per: 'day',
      daily: habitDailyObservations(habit, data.entries.filter((entry) => entry.habitId === habit.id), data.displayTimezone),
    })
  }

  const screen = screenTimeObservations(data.screenTime)
  // Optional features that are off (sharing plan S4) give no measures; their data is kept.
  if (screen.daily.length > 0 && isFeatureOn('screenTime')) {
    measures.push({ id: 'screenTime', label: messages().measures.screenTime, group: messages().measures.groups.screenTime, kind: 'duration', unit: null, per: 'day', daily: screen.daily })
  }

  if (data.location.length > 0 && isFeatureOn('location')) {
    const series = locationSeries(data.location)
    const location = (id: string, label: string, kind: MeasureKind, unit: string | null, daily: Observation[]) =>
      measures.push({ id: `location:${id}`, label, group: messages().measures.groups.location, kind, unit, per: 'day', daily })
    location('distance', messages().measures.distance, 'number', 'km', series.daily.distance)
    location('active', messages().measures.active, 'duration', null, series.daily.active)
    location('places', messages().measures.places, 'number', null, series.daily.places)
    if (series.hasHome) location('away:home', messages().measures.awayFromHome, 'duration', null, awayFromSeries(series, HOME_PLACE_KEY))
    for (const place of listPlaces(data.location)) {
      if (!place.isHome && !data.placeNames[place.key] && place.days < MIN_PLACE_DAYS) continue
      // Unnamed places share a type label ("Place"): add days and hours to tell them apart.
      const hint = place.isHome || data.placeNames[place.key] ? '' : messages().measures.placeHint(place.days, Math.round(place.totalMs / 3_600_000))
      location(`in:${place.key}`, messages().measures.timeIn(placeLabel(place, data.placeNames), hint), 'duration', null, timeInSeries(series, place.key))
    }
  }

  // Health Connect (one source per kind, docs/HEALTH_DATA_PLAN.md) and YNAB.
  const health = data.health ?? []
  const healthMeasure = (id: string, label: string, kind: MeasureKind, unit: string | null, daily: Observation[]) => {
    if (daily.length > 0) measures.push({ id: `health:${id}`, label, group: messages().measures.groups.health, kind, unit, per: 'day', daily })
  }
  healthMeasure('steps', messages().measures.steps, 'number', messages().measures.stepsUnit, healthSeries(health, 'steps').daily)
  healthMeasure('distance', messages().measures.healthDistance, 'number', 'km', healthSeries(health, 'distance').daily)
  healthMeasure('restingHeartRate', messages().measures.restingHeartRate, 'number', 'bpm', healthSeries(health, 'restingHeartRate').daily)
  healthMeasure('heartRate', messages().measures.heartRate, 'number', 'bpm', healthSeries(health, 'heartRate').daily)
  healthMeasure('exercise', messages().measures.exercise, 'duration', null, exerciseSummary(health).daily)
  const ynab = data.ynab ?? []
  if (ynab.length > 0 && isFeatureOn('ynab')) {
    const lastDay = today ?? ynab.map((sample) => String((sample.metadata as { localDate?: unknown } | null)?.localDate)).sort().at(-1) ?? ''
    const spending = spendingSummary(ynab, lastDay)
    measures.push({ id: 'ynab:spending', label: messages().measures.spending, group: messages().measures.groups.money, kind: 'number', unit: spending.currency, per: 'day', daily: spending.daily })
  }

  const base = [...measures]
  for (const formula of data.formulas ?? []) {
    const series = formulaDaily(formula, base)
    if (series.status !== 'ok') continue
    measures.push({
      id: `formula:${formula.id}`,
      label: formula.name,
      group: messages().measures.groups.formulas,
      kind: formula.display === 'duration' ? 'duration' : 'number',
      unit: formula.display === 'number' ? formula.unit : null,
      per: 'day',
      daily: series.daily,
    })
  }

  return measures
}
