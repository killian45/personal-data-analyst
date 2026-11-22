import { messages } from '../i18n'
import { parseLatLng } from '../location/location'

/**
 * Reader for the on-phone Google Maps Timeline export ("Timeline.json",
 * Settings → Location → Timeline → Export). Pure: no database, no React.
 *
 * Layout (inspected 2026-11-11, structure only):
 * { semanticSegments: [ { startTime, endTime,
 *     startTimeTimezoneUtcOffsetMinutes?, endTimeTimezoneUtcOffsetMinutes?,
 *     visit?: { hierarchyLevel, probability, topCandidate: { placeId,
 *       semanticType, probability, placeLocation: { latLng } } },
 *     activity?: { start: { latLng }, end: { latLng }, distanceMeters,
 *       probability, topCandidate: { type, probability }, parking? },
 *     timelinePath?: [ { point, time } ], timelineMemory?: {...} } ],
 *   rawSignals: [...], userLocationProfile: {...} }
 *
 * Only visits and movements are read (user decision 2026-11-11). Route
 * points, trip summaries, raw signals (GPS, Wi-Fi router addresses) and
 * Google's profile are counted, never read further.
 */

export interface TimelineTime {
  utc: string
  offsetMinutes: number
}

export interface TimelineVisit {
  index: number
  start: TimelineTime
  end: TimelineTime
  placeId: string | null
  lat: number
  lng: number
  semanticType: string
  probability: number | null
  placeProbability: number | null
  hierarchyLevel: number | null
}

export interface TimelineMovement {
  index: number
  start: TimelineTime
  end: TimelineTime
  activityType: string
  distanceMeters: number
  probability: number | null
  typeProbability: number | null
  startLat: number
  startLng: number
  endLat: number
  endLng: number
}

export interface TimelineData {
  visits: TimelineVisit[]
  movements: TimelineMovement[]
  /** Segments that could not be read, with the reason. */
  invalid: { index: number; when: string | null; reason: string }[]
  /** Parts of the file deliberately not imported, with counts. */
  notImported: { label: string; count: number }[]
}

const ISO_WITH_OFFSET = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:\d{2})$/

/**
 * Reads "2026-11-09T08:00:00.000+01:00" → UTC ISO string and offset.
 * The offset written in the time is used: it belongs to that exact moment.
 * The separate "...TimezoneUtcOffsetMinutes" fields are ignored — on a
 * clock-change night Google wrote 60 there for a visit starting at
 * "20:03+02:00" (user's export, 24 Oct 2026), which shifted its times.
 */
export function parseTimelineTime(text: unknown): TimelineTime | null {
  if (typeof text !== 'string') return null
  const match = ISO_WITH_OFFSET.exec(text)
  if (!match) return null
  const ms = Date.parse(text)
  if (!Number.isFinite(ms)) return null
  const zone = match[8]
  const offsetFromText = zone === 'Z' ? 0 : (zone.startsWith('-') ? -1 : 1) * (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(4, 6)))
  const offsetMinutes = offsetFromText
  if (Math.abs(offsetMinutes) > 18 * 60) return null
  return { utc: new Date(ms).toISOString(), offsetMinutes }
}

const optionalProbability = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null

const typeCode = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 && value.length <= 200 ? value : null

/** Reads a Timeline export. Throws an Error if the file as a whole cannot be used. */
export function parseTimeline(text: string): TimelineData {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error(messages().importText.timeline.notJson)
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(messages().importText.timeline.notTimeline)
  }
  const root = data as Record<string, unknown>

  if (!Array.isArray(root.semanticSegments)) {
    if (Array.isArray(root.timelineObjects) || Array.isArray(root.locations)) {
      throw new Error(messages().importText.timeline.olderTakeout)
    }
    throw new Error(messages().importText.timeline.noSegments)
  }

  const result: TimelineData = { visits: [], movements: [], invalid: [], notImported: [] }
  let routePoints = 0
  let tripSummaries = 0
  let pathOnly = 0

  root.semanticSegments.forEach((raw, index) => {
    const segment = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
    if (Array.isArray(segment.timelinePath)) routePoints += segment.timelinePath.length
    if (segment.timelineMemory) tripSummaries += 1
    const isVisit = Boolean(segment.visit)
    const isMovement = Boolean(segment.activity)
    if (!isVisit && !isMovement) {
      if (Array.isArray(segment.timelinePath) || segment.timelineMemory) {
        pathOnly += 1
      } else {
        result.invalid.push({ index, when: typeof segment.startTime === 'string' ? segment.startTime : null, reason: 'neither a visit nor a movement' })
      }
      return
    }

    const fail = (reason: string) => result.invalid.push({ index, when: typeof segment.startTime === 'string' ? segment.startTime : null, reason })
    const start = parseTimelineTime(segment.startTime)
    const end = parseTimelineTime(segment.endTime)
    if (!start || !end) return fail('start or end time missing or not readable')
    if (end.utc < start.utc) return fail('ends before it starts')

    if (isVisit) {
      const visit = segment.visit as Record<string, unknown>
      const top = (visit.topCandidate ?? {}) as Record<string, unknown>
      const place = parseLatLng((top.placeLocation as Record<string, unknown> | undefined)?.latLng)
      if (!place) return fail('the place has no readable coordinates')
      const level = visit.hierarchyLevel
      result.visits.push({
        index,
        start,
        end,
        placeId: typeCode(top.placeId),
        lat: place.lat,
        lng: place.lng,
        semanticType: typeCode(top.semanticType) ?? 'UNKNOWN',
        probability: optionalProbability(visit.probability),
        placeProbability: optionalProbability(top.probability),
        hierarchyLevel: typeof level === 'number' && Number.isInteger(level) && level >= 0 ? level : null,
      })
    } else {
      const activity = segment.activity as Record<string, unknown>
      const top = (activity.topCandidate ?? {}) as Record<string, unknown>
      const from = parseLatLng((activity.start as Record<string, unknown> | undefined)?.latLng)
      const to = parseLatLng((activity.end as Record<string, unknown> | undefined)?.latLng)
      if (!from || !to) return fail('the start or end of the movement has no readable coordinates')
      const distance = activity.distanceMeters
      if (typeof distance !== 'number' || !Number.isFinite(distance) || distance < 0) return fail('missing or invalid distance')
      result.movements.push({
        index,
        start,
        end,
        activityType: typeCode(top.type) ?? 'UNKNOWN',
        distanceMeters: distance,
        probability: optionalProbability(activity.probability),
        typeProbability: optionalProbability(top.probability),
        startLat: from.lat,
        startLng: from.lng,
        endLat: to.lat,
        endLng: to.lng,
      })
    }
  })

  const rawSignals = Array.isArray(root.rawSignals) ? root.rawSignals.length : 0
  const profile = root.userLocationProfile && typeof root.userLocationProfile === 'object' ? 1 : 0
  const add = (label: string, count: number) => {
    if (count > 0) result.notImported.push({ label, count })
  }
  add(messages().importText.timeline.routePoints, routePoints)
  add(messages().importText.timeline.routeOnly, pathOnly)
  add(messages().importText.timeline.trips, tripSummaries)
  add(messages().importText.timeline.raw, rawSignals)
  add(messages().importText.timeline.profile, profile)

  return result
}
