import { describe, expect, it } from 'vitest'

import type { ExternalSample } from '../database/types'

import { awayFromSeries, listPlaces, locationSeries, modeGroup, splitByLocalDay, timeInSeries } from './dailyLocation'

/** Local "YYYY-MM-DD HH:mm" at an offset (minutes) → UTC ISO string. */
function utc(local: string, offset = 60): string {
  return new Date(Date.parse(`${local.replace(' ', 'T')}:00Z`) - offset * 60_000).toISOString()
}

let next = 0
function visit(from: string, to: string, semanticType: string, placeId: string, changes: Record<string, unknown> = {}, offset = 60): ExternalSample {
  return {
    id: `v${next++}`, measurementType: 'location_visit', value: 0, unit: 's',
    startUtc: utc(from, offset), endUtc: utc(to, offset), startOffsetMinutes: offset, deletedAt: null,
    metadata: { format: 1, placeId, lat: 1, lng: 1, semanticType, hierarchyLevel: 0, ...changes },
  } as unknown as ExternalSample
}
function move(from: string, to: string, activityType: string, meters: number, offset = 60): ExternalSample {
  return {
    id: `m${next++}`, measurementType: 'location_movement', value: meters, unit: 'm',
    startUtc: utc(from, offset), endUtc: utc(to, offset), startOffsetMinutes: offset, deletedAt: null,
    metadata: { format: 1, activityType },
  } as unknown as ExternalSample
}

/** A fully recorded made-up day (Mon 9 Nov 2026, +01:00). */
const FULL_DAY = [
  visit('2026-11-09 00:00', '2026-11-09 08:00', 'HOME', 'HOME'),
  move('2026-11-09 08:00', '2026-11-09 08:30', 'CYCLING', 6000),
  visit('2026-11-09 08:30', '2026-11-09 17:00', 'INFERRED_WORK', 'OFFICE'),
  visit('2026-11-09 10:00', '2026-11-09 11:00', 'UNKNOWN', 'CAFE_IN_OFFICE', { hierarchyLevel: 1 }), // nested: ignored
  move('2026-11-09 17:00', '2026-11-09 17:20', 'WALKING', 1500),
  visit('2026-11-09 17:20', '2026-11-09 18:00', 'UNKNOWN', 'SHOP'),
  move('2026-11-09 18:00', '2026-11-09 18:40', 'IN_PASSENGER_VEHICLE', 20000),
  visit('2026-11-09 18:40', '2026-11-10 00:00', 'INFERRED_HOME', 'HOME'),
]

describe('splitByLocalDay', () => {
  it('splits at local midnight of the recorded offset (hand-calculated)', () => {
    // 23:00–01:30 at +01:00 → 60 min on the 9th, 90 min on the 10th.
    expect(splitByLocalDay(utc('2026-11-09 23:00'), utc('2026-11-10 01:30'), 60)).toEqual([
      { date: '2026-11-09', ms: 3_600_000, fraction: 0.4 },
      { date: '2026-11-10', ms: 5_400_000, fraction: 0.6 },
    ])
  })
})

describe('locationSeries', () => {
  it('computes the four measures for a fully recorded day (hand-calculated)', () => {
    const series = locationSeries(FULL_DAY)
    // Distance 6 + 1.5 + 20 = 27.5 km.
    expect(series.daily.distance).toEqual([{ date: '2026-11-09', value: 27.5 }])
    // Active: 30 + 20 min = 50 min.
    expect(series.daily.active[0].value).toBeCloseTo(50 / 60, 10)
    // Away: 30 min + 8 h 30 + 20 min + 40 min + 40 min = 10 h 40 (nested café not added).
    expect(series.daily.away[0].value).toBeCloseTo(10 + 40 / 60, 10)
    // Places (not home, top level): OFFICE and SHOP.
    expect(series.daily.places).toEqual([{ date: '2026-11-09', value: 2 }])
    expect(series.byDay.get('2026-11-09')?.distanceByGroup).toEqual({ cycling: 6, walking: 1.5, road: 20, rail: 0, other: 0 })
    expect(series.byDay.get('2026-11-09')?.recordedMs).toBe(24 * 3_600_000)
    expect(series.hasHome).toBe(true)
  })

  it('leaves out days with less than 20 h recorded (missing, never 0)', () => {
    const series = locationSeries([
      ...FULL_DAY,
      visit('2026-11-10 00:00', '2026-11-10 10:00', 'HOME', 'HOME'), // only 10 h on the 10th
    ])
    expect(series.daily.distance.map((o) => o.date)).toEqual(['2026-11-09'])
    expect(series.partialDays).toEqual(['2026-11-10'])
  })

  it('counts 0 on a recorded day without movements or other places', () => {
    const series = locationSeries([visit('2026-11-11 00:00', '2026-11-12 00:00', 'HOME', 'HOME')])
    expect([series.daily.distance[0].value, series.daily.active[0].value, series.daily.away[0].value, series.daily.places[0].value]).toEqual([0, 0, 0, 0])
  })

  it('shares a movement crossing midnight by time (10 km, half each side)', () => {
    const series = locationSeries([
      visit('2026-11-09 00:00', '2026-11-09 23:00', 'HOME', 'HOME'),
      move('2026-11-09 23:00', '2026-11-10 01:00', 'IN_TRAIN', 10000),
      visit('2026-11-10 01:00', '2026-11-11 00:00', 'HOME', 'HOME'),
    ])
    expect(series.daily.distance).toEqual([{ date: '2026-11-09', value: 5 }, { date: '2026-11-10', value: 5 }])
    expect(series.byDay.get('2026-11-10')?.distanceByGroup.rail).toBe(5)
  })

  it('handles the 25-hour clock-change day (Paris, 25 Oct 2026)', () => {
    const series = locationSeries([
      visit('2026-10-25 00:00', '2026-10-25 03:00', 'HOME', 'HOME', {}, 120), // 3 h at +02:00
      visit('2026-10-25 02:00', '2026-10-26 00:00', 'HOME', 'HOME', {}, 60), // 22 h at +01:00
    ])
    expect(series.byDay.get('2026-10-25')?.recordedMs).toBe(25 * 3_600_000)
    expect([...series.clockChanges.entries()]).toEqual([['2026-10-25', 25]])
  })

  it('has no "time away" without any home visit, and ignores deleted records', () => {
    const series = locationSeries([
      visit('2026-11-09 00:00', '2026-11-10 00:00', 'UNKNOWN', 'HOTEL'),
      { ...move('2026-11-09 08:00', '2026-11-09 09:00', 'CYCLING', 9000), deletedAt: '2026-11-10T00:00:00.000Z' },
    ])
    expect(series.hasHome).toBe(false)
    expect(series.daily.away).toEqual([])
    expect(series.daily.distance).toEqual([{ date: '2026-11-09', value: 0 }])
    expect(series.daily.places).toEqual([{ date: '2026-11-09', value: 1 }])
  })

  it('does not count long, almost motionless "movements" as active travel or time away (user report)', () => {
    const series = locationSeries([
      // Overnight "cycling" 23:00–07:00 at 0.1 km/h (8 h, 800 m): not real travel.
      visit('2026-11-09 00:00', '2026-11-09 23:00', 'HOME', 'HOME'),
      move('2026-11-09 23:00', '2026-11-10 07:00', 'CYCLING', 800),
      // A real 20-min ride the next morning, and a slow but short walk (10 min at 0.6 km/h).
      move('2026-11-10 07:00', '2026-11-10 07:20', 'CYCLING', 5000),
      move('2026-11-10 07:20', '2026-11-10 07:30', 'WALKING', 100),
      visit('2026-11-10 07:30', '2026-11-11 00:00', 'HOME', 'HOME'),
    ])
    // 10th: active = 20 min ride + 10 min walk = 30 min; the 7 h of "cycling" excluded.
    expect(series.daily.active.find((o) => o.date === '2026-11-10')?.value).toBeCloseTo(0.5, 10)
    // The motionless night starts right after a Home visit → counted at home:
    // away on the 10th = the real 30 min of travel only.
    expect(series.daily.away.find((o) => o.date === '2026-11-10')?.value).toBeCloseTo(0.5, 10)
    expect(series.unlocatedDays).toEqual([])
    expect([...series.stillAttributed.entries()]).toEqual([['2026-11-09', 1], ['2026-11-10', 1]])
    // Its distance still counts: 800 m shared 1 h / 7 h between the days.
    expect(series.daily.distance.find((o) => o.date === '2026-11-10')?.value).toBeCloseTo(0.7 + 5 + 0.1, 10)
    // Still recorded time: both days stay complete (24 h).
    expect(series.byDay.get('2026-11-09')?.recordedMs).toBe(24 * 3_600_000)
    expect([...series.stillMovements.entries()]).toEqual([['2026-11-09', 1], ['2026-11-10', 1]])
  })

  it('lists top-level places, most time first, home visits as one Home (hand-calculated)', () => {
    const places = listPlaces(FULL_DAY)
    expect(places.map((place) => [place.key, place.isHome, place.semanticType, place.days, place.totalMs / 60_000])).toEqual([
      ['home', true, 'HOME', 1, 8 * 60 + 5 * 60 + 20], // 8 h (HOME) + 5 h 20 (INFERRED_HOME)
      ['OFFICE', false, 'INFERRED_WORK', 1, 8 * 60 + 30],
      ['SHOP', false, 'UNKNOWN', 1, 40],
    ])
    expect(places[0]).toMatchObject({ lat: 1, lng: 1 })
  })

  it('computes time away from any chosen place (hand-calculated)', () => {
    const series = locationSeries(FULL_DAY)
    // From the office: 24 h − 8 h 30 at the office = 15 h 30.
    expect(awayFromSeries(series, 'OFFICE')).toEqual([{ date: '2026-11-09', value: 15.5 }])
    // From home: same as "time away from home" (10 h 40).
    expect(awayFromSeries(series, 'home')[0].value).toBeCloseTo(series.daily.away[0].value!, 10)
    // A place never visited: nothing to be away from.
    expect(awayFromSeries(series, 'NOWHERE')).toEqual([])
  })

  it('leaves days with too many unknown-place hours out of the place views only (user report)', () => {
    const series = locationSeries([
      // 9th: home until 12:50, then (10 min later, so not attached to it) an
      // 11-hour motionless "cycling" → place known only 12 h 50.
      visit('2026-11-09 00:00', '2026-11-09 12:50', 'HOME', 'HOME'),
      move('2026-11-09 13:00', '2026-11-10 00:00', 'CYCLING', 1100),
      // 10th: fully known (home 20 h, office 4 h).
      visit('2026-11-10 00:00', '2026-11-10 20:00', 'HOME', 'HOME'),
      visit('2026-11-10 20:00', '2026-11-11 00:00', 'UNKNOWN', 'OFFICE'),
    ])
    // Distance and active travel: both days (recorded 24 h each).
    expect(series.daily.distance.map((o) => o.date)).toEqual(['2026-11-09', '2026-11-10'])
    // Place views: only the 10th.
    expect(series.unlocatedDays).toEqual(['2026-11-09'])
    expect(series.daily.away).toEqual([{ date: '2026-11-10', value: 4 }])
    expect(series.daily.places).toEqual([{ date: '2026-11-10', value: 1 }])
    expect(awayFromSeries(series, 'OFFICE')).toEqual([{ date: '2026-11-10', value: 20 }])
    expect(timeInSeries(series, 'OFFICE')).toEqual([{ date: '2026-11-10', value: 4 }])
  })

  it('computes time in a chosen place, 0 on known days without a visit (hand-calculated)', () => {
    const series = locationSeries([
      ...FULL_DAY,
      visit('2026-11-10 00:00', '2026-11-11 00:00', 'HOME', 'HOME'),
    ])
    expect(timeInSeries(series, 'OFFICE')).toEqual([{ date: '2026-11-09', value: 8.5 }, { date: '2026-11-10', value: 0 }])
    // Home: 8 h + 5 h 20 on the 9th, all day on the 10th.
    const home = timeInSeries(series, 'home').map((o) => o.value as number)
    expect(home[0]).toBeCloseTo(13 + 20 / 60, 10)
    expect(home[1]).toBe(24)
    expect(timeInSeries(series, 'NOWHERE')).toEqual([])
  })

  it('counts a motionless movement at the place it starts from (user decision)', () => {
    const series = locationSeries([
      // At home until 22:00, then 10 h of motionless "cycling" (1 km), then the office.
      visit('2026-11-09 00:00', '2026-11-09 22:00', 'HOME', 'HOME'),
      move('2026-11-09 22:00', '2026-11-10 08:00', 'CYCLING', 1000),
      visit('2026-11-10 08:00', '2026-11-11 00:00', 'UNKNOWN', 'OFFICE'),
    ])
    // 9th: 24 h at home (22 h visit + 2 h of the motionless night); both days located.
    expect(timeInSeries(series, 'home')).toEqual([{ date: '2026-11-09', value: 24 }, { date: '2026-11-10', value: 8 }])
    // Away from a place never visited on the 9th = the full day.
    expect(awayFromSeries(series, 'OFFICE')[0]).toEqual({ date: '2026-11-09', value: 24 })
    expect(series.unlocatedDays).toEqual([])
    // Still not active travel.
    expect(series.daily.active.map((o) => o.value)).toEqual([0, 0])
  })

  it('reports no clock change on normal days', () => {
    expect(locationSeries(FULL_DAY).clockChanges.size).toBe(0)
  })

  it('groups activity types', () => {
    expect(['CYCLING', 'RUNNING', 'IN_BUS', 'IN_SUBWAY', 'FLYING', 'UNKNOWN'].map(modeGroup)).toEqual(['cycling', 'walking', 'road', 'rail', 'other', 'other'])
  })
})
