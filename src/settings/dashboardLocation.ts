import { messages } from '../i18n'
import { getSettingValue, putSetting } from '../database/settings'
import { isLocationMeasure } from '../location/dailyLocation'
import type { LocationMeasure } from '../location/dailyLocation'

/**
 * Which view the Dashboard's Location section shows (user decision
 * 2026-11-11: one section, choose distance / active travel / time away /
 * places). Stored in the synced setting "dashboard.locationMeasure".
 */

export const DASHBOARD_LOCATION_KEY = 'dashboard.locationMeasure'
export const DEFAULT_LOCATION_MEASURE: LocationMeasure = 'distance'

export async function loadLocationMeasure(): Promise<LocationMeasure> {
  const value = await getSettingValue(DASHBOARD_LOCATION_KEY)
  return isLocationMeasure(value) ? value : DEFAULT_LOCATION_MEASURE
}

export async function saveLocationMeasure(measure: LocationMeasure): Promise<LocationMeasure> {
  await putSetting(DASHBOARD_LOCATION_KEY, measure)
  return measure
}

/** The place chosen for "Time away from…" (default: home). */
export const DASHBOARD_AWAY_PLACE_KEY = 'dashboard.locationAwayPlace'
/** Names the user gave to places: JSON { "<place key>": "<name>" }. */
export const PLACE_NAMES_KEY = 'location.placeNames'

const MAX_PLACE_KEY = 300
const MAX_PLACE_NAME = 100
const MAX_NAMED_PLACES = 2000

export function isValidPlaceKey(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_PLACE_KEY
}

/** Parses stored place names; null if the text is not a valid list. */
export function parsePlaceNames(text: string): Record<string, string> | null {
  try {
    const value: unknown = JSON.parse(text)
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length > MAX_NAMED_PLACES) return null
    for (const [key, name] of entries) {
      if (!isValidPlaceKey(key) || typeof name !== 'string' || name.trim().length === 0 || name.length > MAX_PLACE_NAME) return null
    }
    return value as Record<string, string>
  } catch {
    return null
  }
}

export async function loadAwayPlace(): Promise<string> {
  const value = await getSettingValue(DASHBOARD_AWAY_PLACE_KEY)
  return isValidPlaceKey(value) ? value : 'home'
}

export async function saveAwayPlace(placeKey: string): Promise<string> {
  if (!isValidPlaceKey(placeKey)) throw new Error(messages().inputText.invalidPlace)
  await putSetting(DASHBOARD_AWAY_PLACE_KEY, placeKey)
  return placeKey
}

export async function loadPlaceNames(): Promise<Record<string, string>> {
  const value = await getSettingValue(PLACE_NAMES_KEY)
  return (value === null ? null : parsePlaceNames(value)) ?? {}
}

/** Sets (or, with an empty name, removes) the name of one place. */
export async function savePlaceName(placeKey: string, name: string): Promise<Record<string, string>> {
  const trimmed = name.trim()
  if (!isValidPlaceKey(placeKey)) throw new Error(messages().inputText.invalidPlace)
  if (trimmed.length > MAX_PLACE_NAME) throw new Error(messages().inputText.placeNameTooLong(MAX_PLACE_NAME))
  const names = { ...(await loadPlaceNames()) }
  if (trimmed === '') delete names[placeKey]
  else names[placeKey] = trimmed
  await putSetting(PLACE_NAMES_KEY, JSON.stringify(names))
  return names
}
