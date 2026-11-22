import { messages } from '../i18n'
import type { DataSource, ExternalSample } from '../database/types'

/**
 * Location history stored as imported samples (docs/PHASE5_PLAN.md §7).
 * Pure functions, independent of React and of the database.
 *
 * - A visit: time spent at one place. value = duration in whole seconds
 *   (unit "s"); metadata: place id, coordinates, place type, probabilities,
 *   hierarchy level (Google nests places, e.g. a shop inside a mall).
 * - A movement: travel between places. value = distance in metres
 *   (unit "m"); metadata: activity type, start/end coordinates.
 * - Times: start/end UTC; the export gives UTC offsets but no time zone
 *   name, so timezone is null and startOffsetMinutes is kept (like Health
 *   Connect sleep). metadata.endOffsetMinutes keeps the end offset.
 * - Coordinates are kept at the export's original precision (user
 *   decision 2026-11-11).
 */

export const LOCATION_VISIT = 'location_visit'
export const LOCATION_MOVEMENT = 'location_movement'
export const LOCATION_TYPES = [LOCATION_VISIT, LOCATION_MOVEMENT] as const
export const LOCATION_FORMAT = 1

const MAX_SEGMENT_MS = 31 * 24 * 3_600_000
const MAX_DISTANCE_M = 20_000_000
const MAX_TEXT = 200

export interface VisitMetadata {
  format: typeof LOCATION_FORMAT
  placeId: string | null
  lat: number
  lng: number
  /** Google's place type, e.g. HOME, INFERRED_WORK, UNKNOWN. */
  semanticType: string
  /** Confidence of the visit and of the place (0–1), if given. */
  probability: number | null
  placeProbability: number | null
  hierarchyLevel: number | null
  endOffsetMinutes: number | null
  [key: string]: unknown
}

export interface MovementMetadata {
  format: typeof LOCATION_FORMAT
  /** Google's activity type, e.g. CYCLING, WALKING, IN_TRAIN. */
  activityType: string
  probability: number | null
  typeProbability: number | null
  startLat: number
  startLng: number
  endLat: number
  endLng: number
  endOffsetMinutes: number | null
  [key: string]: unknown
}

export function isLocationType(type: string): type is (typeof LOCATION_TYPES)[number] {
  return (LOCATION_TYPES as readonly string[]).includes(type)
}

/** Duplicate-detection key: kind + exact start and end (+ place for visits). */
export function buildLocationDedupeKey(
  source: DataSource,
  measurementType: string,
  startUtc: string,
  endUtc: string,
  placeId: string | null,
): string {
  const kind = measurementType === LOCATION_VISIT ? 'visit' : 'movement'
  return `location:${source}:${kind}:${startUtc}:${endUtc}` + (kind === 'visit' ? `:${placeId ?? ''}` : '')
}

/** "48.1234567°, 2.1234567°" → { lat, lng }, or null if not a valid position. */
export function parseLatLng(text: unknown): { lat: number; lng: number } | null {
  if (typeof text !== 'string') return null
  const match = /^\s*(-?\d{1,3}(?:\.\d+)?)\s*°?\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*°?\s*$/.exec(text)
  if (!match) return null
  const lat = Number(match[1])
  const lng = Number(match[2])
  return isLatitude(lat) && isLongitude(lng) ? { lat, lng } : null
}

const isLatitude = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 90
const isLongitude = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 180

function requireText(value: unknown, field: string): void {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_TEXT) throw new Error(`invalid ${field}`)
}

function requireProbability(value: unknown, field: string): void {
  if (value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1)) {
    throw new Error(`invalid ${field}`)
  }
}

function requireOffset(value: unknown, field: string): void {
  if (value !== null && (typeof value !== 'number' || !Number.isInteger(value) || Math.abs(value) > 18 * 60)) {
    throw new Error(`invalid ${field}`)
  }
}

/**
 * Checks the location part of an imported sample (import, restore and
 * sync). Throws an Error explaining the first problem found.
 */
export function validateLocationSample(
  sample: Pick<ExternalSample, 'source' | 'dedupeKey' | 'measurementType' | 'value' | 'unit' | 'startUtc' | 'endUtc' | 'startOffsetMinutes' | 'metadata'>,
): void {
  if (!isLocationType(sample.measurementType)) throw new Error('unknown kind of imported sample')
  if (sample.source !== 'import') throw new Error('invalid source for location history')
  if (sample.endUtc === null) throw new Error('a location segment needs an end')
  if (sample.startOffsetMinutes === null) throw new Error('a location segment needs its UTC offset')

  const durationMs = Date.parse(sample.endUtc) - Date.parse(sample.startUtc)
  if (!(durationMs >= 0 && durationMs <= MAX_SEGMENT_MS)) {
    throw new Error('the end must be after the start, at most 31 days later')
  }

  const meta = sample.metadata
  if (!meta || meta.format !== LOCATION_FORMAT) throw new Error('unknown location format')
  requireOffset(meta.endOffsetMinutes ?? null, 'end UTC offset')
  requireProbability(meta.probability ?? null, 'probability')

  if (sample.measurementType === LOCATION_VISIT) {
    if (sample.unit !== 's') throw new Error('a visit must be stored in seconds')
    if (sample.value !== Math.round(durationMs / 1000)) throw new Error('the visit duration does not match its times')
    if (meta.placeId !== null) requireText(meta.placeId, 'place id')
    if (!isLatitude(meta.lat) || !isLongitude(meta.lng)) throw new Error('invalid place coordinates')
    requireText(meta.semanticType, 'place type')
    requireProbability(meta.placeProbability ?? null, 'place probability')
    if (meta.hierarchyLevel !== null && (typeof meta.hierarchyLevel !== 'number' || !Number.isInteger(meta.hierarchyLevel) || meta.hierarchyLevel < 0)) {
      throw new Error('invalid hierarchy level')
    }
  } else {
    if (sample.unit !== 'm') throw new Error('a movement must be stored in metres')
    if (typeof sample.value !== 'number' || !Number.isFinite(sample.value) || sample.value < 0 || sample.value > MAX_DISTANCE_M) {
      throw new Error('invalid distance')
    }
    requireText(meta.activityType, 'activity type')
    requireProbability(meta.typeProbability ?? null, 'activity probability')
    if (!isLatitude(meta.startLat) || !isLongitude(meta.startLng) || !isLatitude(meta.endLat) || !isLongitude(meta.endLng)) {
      throw new Error('invalid start or end coordinates')
    }
  }

  const placeId = sample.measurementType === LOCATION_VISIT ? ((meta.placeId as string | null) ?? null) : null
  if (sample.dedupeKey !== buildLocationDedupeKey(sample.source, sample.measurementType, sample.startUtc, sample.endUtc, placeId)) {
    throw new Error('its duplicate-detection key does not match its data')
  }
}

/**
 * English label of a Google place or activity type, used in EXPORTS (which
 * stay in English, owner decision 2026-11-21). Screens use placeTypeLabel.
 */
export function describeLocationType(code: string): string {
  const labels: Record<string, string> = {
    HOME: 'Home',
    INFERRED_HOME: 'Home (guessed)',
    WORK: 'Work',
    INFERRED_WORK: 'Work (guessed)',
    ALIASED_LOCATION: 'Saved place',
    UNKNOWN: 'Place',
    CYCLING: 'Cycling',
    WALKING: 'Walking',
    RUNNING: 'Running',
    IN_PASSENGER_VEHICLE: 'Car',
    IN_VEHICLE: 'Vehicle',
    IN_BUS: 'Bus',
    IN_TRAIN: 'Train',
    IN_SUBWAY: 'Metro',
    IN_TRAM: 'Tram',
    FLYING: 'Plane',
    MOTORCYCLING: 'Motorcycle',
    IN_FERRY: 'Ferry',
  }
  return labels[code] ?? readableCode(code)
}

function readableCode(code: string): string {
  return code.charAt(0) + code.slice(1).toLowerCase().replace(/_/g, ' ')
}

/** Label of a Google place or activity type on screens (in the app's language). */
export function placeTypeLabel(code: string): string {
  return messages().labels.placeTypes[code] ?? readableCode(code)
}
