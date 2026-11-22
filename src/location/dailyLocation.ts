import type { ExternalSample } from '../database/types'
import { messages } from '../i18n'
import type { Observation } from '../stats/subjects'

import { LOCATION_MOVEMENT, LOCATION_VISIT } from './location'

/**
 * Daily location measures for the Dashboard (docs/PHASE5_PLAN.md §7.6;
 * user decisions 2026-11-11). Pure functions.
 *
 * Conventions:
 * - A day is the calendar day at the segment's recorded UTC offset (its
 *   start offset; "day as lived"). Segments crossing midnight are split
 *   there; a movement's distance is shared in proportion to its time.
 * - Only top-level visits (place level 0, or no level) count: nested
 *   places would count the same time twice. Movements always count.
 * - Each segment counts as recorded (Google's most likely type), whatever
 *   its probability.
 * - Recorded day: visits + movements cover at least 20 h of it. Other
 *   days are missing (absent), never 0. On a recorded day, no movement
 *   means 0 km, no away time means 0 h.
 * - Home: visits of type HOME or INFERRED_HOME, all counted as one place
 *   (key "home"). Other places are keyed by place id (or coordinates).
 * - Time away from a place P = recorded time − time at P − motionless
 *   movements, i.e. real travel plus visits elsewhere (user request
 *   2026-11-11: choose the place; Home by default).
 * - Place-based views (time away, time in, places visited) need to know
 *   WHERE you were: a day counts only if visits + real movements ("located
 *   time", i.e. recorded time minus motionless movements) reach 20 h.
 *   Otherwise the unknown hours would look like time at (or away from)
 *   any place (user report 2026-11-11: 13, 14, 20 Oct). Distance and
 *   active travel only need the recorded-day rule.
 * - Implausible movements (user report 2026-11-11: overnight "cycling" of
 *   8–11 h at 0.1 km/h): a movement lasting more than 30 min at an average
 *   below 1 km/h is "not really moving" — it counts as recorded time and
 *   its (tiny) distance counts, but it is NOT active travel. Its time
 *   counts at the place you were just before (a top-level visit ending
 *   at most 5 min before it starts; user decision 2026-11-11 — e.g. an
 *   overnight "cycling" starting right after a Home visit = at home);
 *   without such a visit its place stays unknown. Counted in
 *   `stillMovements` (all) and `stillAttributed` (placed).
 * - Clock-change days last 23 or 25 real hours and are kept as such
 *   (real elapsed time); `clockChanges` lists them with their length.
 * - Durations are in hours (like stopwatch habits), distances in km.
 * - Deleted records are ignored.
 */

export const RECORDED_DAY_HOURS = 20
/** Movements longer than this at an average below MIN_MOVING_KMH are not real travel. */
export const STILL_MOVEMENT_MINUTES = 30
export const MIN_MOVING_KMH = 1
/** A motionless movement belongs to the visit that ends at most this long before it. */
const ATTACH_GAP_MS = 5 * 60_000
const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS

export const LOCATION_MEASURES = ['distance', 'active', 'in', 'away', 'places'] as const
export type LocationMeasure = (typeof LOCATION_MEASURES)[number]

export function isLocationMeasure(value: unknown): value is LocationMeasure {
  return typeof value === 'string' && (LOCATION_MEASURES as readonly string[]).includes(value)
}

export const MODE_GROUPS = ['cycling', 'walking', 'road', 'rail', 'other'] as const
export type ModeGroup = (typeof MODE_GROUPS)[number]

/* Getters: the text of the current language is read when used (sharing plan S2i). */
export const MODE_GROUP_LABELS: Record<ModeGroup, string> = {
  get cycling() { return messages().labels.modeGroups.cycling },
  get walking() { return messages().labels.modeGroups.walking },
  get road() { return messages().labels.modeGroups.road },
  get rail() { return messages().labels.modeGroups.rail },
  get other() { return messages().labels.modeGroups.other },
}

const GROUP_OF: Record<string, ModeGroup> = {
  CYCLING: 'cycling',
  ON_BICYCLE: 'cycling',
  WALKING: 'walking',
  RUNNING: 'walking',
  ON_FOOT: 'walking',
  HIKING: 'walking',
  IN_PASSENGER_VEHICLE: 'road',
  IN_VEHICLE: 'road',
  IN_ROAD_VEHICLE: 'road',
  IN_BUS: 'road',
  IN_TAXI: 'road',
  MOTORCYCLING: 'road',
  IN_TRAIN: 'rail',
  IN_RAIL_VEHICLE: 'rail',
  IN_SUBWAY: 'rail',
  IN_TRAM: 'rail',
}

/** Activity types counted as active travel (cycling, walking, running). */
export function modeGroup(activityType: string): ModeGroup {
  return GROUP_OF[activityType] ?? 'other'
}

const HOME_TYPES = new Set(['HOME', 'INFERRED_HOME'])

interface Piece {
  date: string
  ms: number
  fraction: number
}

/** Splits a segment at local midnights of its recorded offset. */
export function splitByLocalDay(startUtc: string, endUtc: string, offsetMinutes: number): Piece[] {
  const start = Date.parse(startUtc)
  const end = Date.parse(endUtc)
  const total = end - start
  const shift = offsetMinutes * 60_000
  const pieces: Piece[] = []
  let cursor = start
  while (cursor < end) {
    const local = cursor + shift
    const nextMidnight = Math.floor(local / DAY_MS) * DAY_MS + DAY_MS - shift
    const pieceEnd = Math.min(end, nextMidnight)
    pieces.push({
      date: new Date(local).toISOString().slice(0, 10),
      ms: pieceEnd - cursor,
      fraction: total > 0 ? (pieceEnd - cursor) / total : 0,
    })
    cursor = pieceEnd
  }
  return pieces
}

export const HOME_PLACE_KEY = 'home'

export interface DayLocation {
  recordedMs: number
  distanceKm: number
  distanceByGroup: Record<ModeGroup, number>
  activeMs: number
  /** Time away from home (see conventions). */
  awayMs: number
  places: Set<string>
  /** Time at each top-level place (key "home" for home). */
  atPlace: Map<string, number>
  /** Motionless "movements" (not real travel). */
  stillMs: number
}

/** One place you visited (top-level), for the "Time away from…" menu. */
export interface PlaceSummary {
  key: string
  isHome: boolean
  /** Most frequent Google type of its visits, e.g. INFERRED_WORK. */
  semanticType: string
  /** Different days with a visit, and total time there (ms). */
  days: number
  totalMs: number
  /** Position for the map link. */
  lat: number
  lng: number
}

/** The key of a visit's place (home visits share one key). */
export function placeKeyOf(meta: Record<string, unknown>): string {
  if (HOME_TYPES.has(String(meta.semanticType))) return HOME_PLACE_KEY
  return typeof meta.placeId === 'string' ? meta.placeId : `${String(meta.lat)},${String(meta.lng)}`
}

/** Your top-level places, most time spent first. */
export function listPlaces(samples: readonly ExternalSample[]): PlaceSummary[] {
  const places = new Map<string, { types: Map<string, number>; days: Set<string>; totalMs: number; positions: Map<string, number> }>()
  for (const sample of samples) {
    if (sample.deletedAt !== null || sample.endUtc === null || sample.measurementType !== LOCATION_VISIT) continue
    const meta = sample.metadata ?? {}
    if (typeof meta.hierarchyLevel === 'number' && meta.hierarchyLevel > 0) continue
    const key = placeKeyOf(meta)
    let place = places.get(key)
    if (!place) {
      place = { types: new Map(), days: new Set(), totalMs: 0, positions: new Map() }
      places.set(key, place)
    }
    const ms = Date.parse(sample.endUtc) - Date.parse(sample.startUtc)
    const type = String(meta.semanticType)
    const position = `${String(meta.lat)},${String(meta.lng)}`
    place.types.set(type, (place.types.get(type) ?? 0) + ms)
    place.positions.set(position, (place.positions.get(position) ?? 0) + ms)
    place.totalMs += ms
    for (const piece of splitByLocalDay(sample.startUtc, sample.endUtc, sample.startOffsetMinutes ?? 0)) place.days.add(piece.date)
  }
  const top = (map: Map<string, number>) => [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0]
  return [...places.entries()]
    .map(([key, place]) => {
      const [lat, lng] = top(place.positions).split(',').map(Number)
      return { key, isHome: key === HOME_PLACE_KEY, semanticType: top(place.types), days: place.days.size, totalMs: place.totalMs, lat, lng }
    })
    .sort((a, b) => b.totalMs - a.totalMs || a.key.localeCompare(b.key))
}

export interface LocationSeries {
  /**
   * Values per day, in the measure's unit (km, hours, count). Place views
   * with a chosen place ("in", "away" from any place) use timeInSeries /
   * awayFromSeries; "away" here is away from home.
   */
  daily: Record<Exclude<LocationMeasure, 'in'>, Observation[]>
  /** Per recorded day, for the per-mode tiles. */
  byDay: Map<string, DayLocation>
  /** Days with data that were too little recorded (missing, not 0). */
  partialDays: string[]
  /** Recorded days where the place was unknown for too long (left out of place views). */
  unlocatedDays: string[]
  /** Whether any home visit exists (needed for "time away from home"). */
  hasHome: boolean
  /** Days with movements treated as not real travel (see conventions), and how many. */
  stillMovements: Map<string, number>
  /** Of those, how many were counted at the place they started from. */
  stillAttributed: Map<string, number>
  /** Days whose real length is not 24 h (clock changes), with their length in hours. */
  clockChanges: Map<string, number>
}

/** The place is known for at least RECORDED_DAY_HOURS (see conventions). */
export function isLocatedDay(day: DayLocation): boolean {
  return day.recordedMs - day.stillMs >= RECORDED_DAY_HOURS * HOUR_MS
}

/** A long movement at almost no speed (see conventions). */
export function isStillMovement(startUtc: string, endUtc: string, meters: number): boolean {
  const hours = (Date.parse(endUtc) - Date.parse(startUtc)) / HOUR_MS
  return hours * 60 > STILL_MOVEMENT_MINUTES && meters / 1000 / hours < MIN_MOVING_KMH
}

function emptyDay(): DayLocation {
  return {
    recordedMs: 0,
    distanceKm: 0,
    distanceByGroup: { cycling: 0, walking: 0, road: 0, rail: 0, other: 0 },
    activeMs: 0,
    awayMs: 0,
    places: new Set(),
    atPlace: new Map(),
    stillMs: 0,
  }
}

export function locationSeries(samples: readonly ExternalSample[]): LocationSeries {
  const days = new Map<string, DayLocation>()
  const day = (date: string) => {
    let entry = days.get(date)
    if (!entry) {
      entry = emptyDay()
      days.set(date, entry)
    }
    return entry
  }
  let hasHome = false
  const stillMovements = new Map<string, number>()
  const stillAttributed = new Map<string, number>()
  const count = (map: Map<string, number>, date: string) => map.set(date, (map.get(date) ?? 0) + 1)

  // Offsets seen each day (earliest and latest piece), to detect clock changes.
  const offsets = new Map<string, { firstMs: number; first: number; lastMs: number; last: number }>()
  const noteOffset = (date: string, atMs: number, offset: number) => {
    const known = offsets.get(date)
    if (!known) offsets.set(date, { firstMs: atMs, first: offset, lastMs: atMs, last: offset })
    else {
      if (atMs < known.firstMs) Object.assign(known, { firstMs: atMs, first: offset })
      if (atMs > known.lastMs) Object.assign(known, { lastMs: atMs, last: offset })
    }
  }

  // Top-level visits by end time, to place motionless movements.
  const visitEnds = samples
    .filter((sample) => sample.deletedAt === null && sample.endUtc !== null && sample.measurementType === LOCATION_VISIT)
    .filter((sample) => !(typeof sample.metadata?.hierarchyLevel === 'number' && sample.metadata.hierarchyLevel > 0))
    .map((sample) => ({ endMs: Date.parse(sample.endUtc as string), key: placeKeyOf(sample.metadata ?? {}) }))
  const placeBefore = (startUtc: string): string | null => {
    const start = Date.parse(startUtc)
    const candidates = visitEnds.filter((visit) => visit.endMs <= start && start - visit.endMs <= ATTACH_GAP_MS)
    candidates.sort((a, b) => b.endMs - a.endMs)
    return candidates[0]?.key ?? null
  }

  for (const sample of samples) {
    if (sample.deletedAt !== null || sample.endUtc === null) continue
    const meta = sample.metadata ?? {}
    const offset = sample.startOffsetMinutes ?? 0
    const pieces = splitByLocalDay(sample.startUtc, sample.endUtc, offset)
    let pieceStart = Date.parse(sample.startUtc)
    for (const piece of pieces) {
      noteOffset(piece.date, pieceStart, offset)
      pieceStart += piece.ms
    }

    if (sample.measurementType === LOCATION_VISIT) {
      const level = meta.hierarchyLevel
      if (typeof level === 'number' && level > 0) continue
      const placeKey = placeKeyOf(meta)
      const home = placeKey === HOME_PLACE_KEY
      if (home) hasHome = true
      for (const piece of pieces) {
        const entry = day(piece.date)
        entry.recordedMs += piece.ms
        entry.atPlace.set(placeKey, (entry.atPlace.get(placeKey) ?? 0) + piece.ms)
        if (!home) {
          entry.awayMs += piece.ms
          entry.places.add(placeKey)
        }
      }
    } else if (sample.measurementType === LOCATION_MOVEMENT) {
      const group = modeGroup(String(meta.activityType))
      const still = isStillMovement(sample.startUtc, sample.endUtc, sample.value)
      const stayedAt = still ? placeBefore(sample.startUtc) : null
      for (const piece of pieces) {
        const entry = day(piece.date)
        const km = (sample.value * piece.fraction) / 1000
        entry.recordedMs += piece.ms
        entry.distanceKm += km
        entry.distanceByGroup[group] += km
        if (still) {
          count(stillMovements, piece.date)
          if (stayedAt === null) {
            entry.stillMs += piece.ms
          } else {
            count(stillAttributed, piece.date)
            entry.atPlace.set(stayedAt, (entry.atPlace.get(stayedAt) ?? 0) + piece.ms)
            if (stayedAt !== HOME_PLACE_KEY) {
              entry.awayMs += piece.ms
              entry.places.add(stayedAt)
            }
          }
          continue
        }
        entry.awayMs += piece.ms
        if (group === 'cycling' || group === 'walking') entry.activeMs += piece.ms
      }
    }
  }

  const daily: Record<Exclude<LocationMeasure, 'in'>, Observation[]> = { distance: [], active: [], away: [], places: [] }
  const byDay = new Map<string, DayLocation>()
  const partialDays: string[] = []
  const unlocatedDays: string[] = []

  for (const date of [...days.keys()].sort()) {
    const entry = days.get(date) as DayLocation
    if (entry.recordedMs < RECORDED_DAY_HOURS * HOUR_MS) {
      partialDays.push(date)
      continue
    }
    byDay.set(date, entry)
    daily.distance.push({ date, value: entry.distanceKm })
    daily.active.push({ date, value: entry.activeMs / HOUR_MS })
    if (!isLocatedDay(entry)) {
      unlocatedDays.push(date)
      continue
    }
    if (hasHome) daily.away.push({ date, value: entry.awayMs / HOUR_MS })
    daily.places.push({ date, value: entry.places.size })
  }

  const clockChanges = new Map<string, number>()
  for (const [date, seen] of offsets) {
    if (seen.first !== seen.last) clockChanges.set(date, 24 + (seen.first - seen.last) / 60)
  }

  return { daily, byDay, partialDays, unlocatedDays, hasHome, stillMovements, stillAttributed, clockChanges }
}

/**
 * Time away from one place per recorded day, in hours: recorded time
 * minus time at that place minus motionless movements. Empty when the
 * place was never visited (nothing to be "away from").
 */
export function awayFromSeries(series: LocationSeries, placeKey: string): Observation[] {
  const located = [...series.byDay.entries()].filter(([, day]) => isLocatedDay(day))
  if (!located.some(([, day]) => day.atPlace.has(placeKey))) return []
  return located.map(([date, day]) => ({
    date,
    value: (day.recordedMs - (day.atPlace.get(placeKey) ?? 0) - day.stillMs) / HOUR_MS,
  }))
}

/**
 * Time spent at one place per located day, in hours (0 on a located day
 * without a visit there). Empty when the place was never visited.
 */
export function timeInSeries(series: LocationSeries, placeKey: string): Observation[] {
  const located = [...series.byDay.entries()].filter(([, day]) => isLocatedDay(day))
  if (!located.some(([, day]) => day.atPlace.has(placeKey))) return []
  return located.map(([date, day]) => ({ date, value: (day.atPlace.get(placeKey) ?? 0) / HOUR_MS }))
}
