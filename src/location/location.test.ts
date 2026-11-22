import { describe, expect, it } from 'vitest'

import type { ExternalSample } from '../database/types'

import { buildLocationDedupeKey, describeLocationType, validateLocationSample } from './location'

const visit: Pick<ExternalSample, 'source' | 'dedupeKey' | 'measurementType' | 'value' | 'unit' | 'startUtc' | 'endUtc' | 'startOffsetMinutes' | 'metadata'> = {
  source: 'import',
  dedupeKey: buildLocationDedupeKey('import', 'location_visit', '2026-11-09T07:00:00.000Z', '2026-11-09T11:00:00.000Z', 'PLACE_A'),
  measurementType: 'location_visit',
  value: 14_400,
  unit: 's',
  startUtc: '2026-11-09T07:00:00.000Z',
  endUtc: '2026-11-09T11:00:00.000Z',
  startOffsetMinutes: 60,
  metadata: { format: 1, placeId: 'PLACE_A', lat: 45, lng: 5, semanticType: 'HOME', probability: 0.9, placeProbability: 0.8, hierarchyLevel: 0, endOffsetMinutes: 60 },
}

const movement: typeof visit = {
  ...visit,
  dedupeKey: buildLocationDedupeKey('import', 'location_movement', '2026-11-09T11:00:00.000Z', '2026-11-09T11:20:00.000Z', null),
  measurementType: 'location_movement',
  value: 3210.5,
  unit: 'm',
  startUtc: '2026-11-09T11:00:00.000Z',
  endUtc: '2026-11-09T11:20:00.000Z',
  metadata: { format: 1, activityType: 'CYCLING', probability: 0.95, typeProbability: 0.7, startLat: 45, startLng: 5, endLat: 45.01, endLng: -5.02, endOffsetMinutes: 60 },
}

describe('location keys and labels', () => {
  it('builds keys from kind, exact times and (for visits) the place', () => {
    expect(visit.dedupeKey).toBe('location:import:visit:2026-11-09T07:00:00.000Z:2026-11-09T11:00:00.000Z:PLACE_A')
    expect(movement.dedupeKey).toBe('location:import:movement:2026-11-09T11:00:00.000Z:2026-11-09T11:20:00.000Z')
  })

  it('describes Google codes in plain words, unknown ones readably', () => {
    expect(describeLocationType('INFERRED_HOME')).toBe('Home (guessed)')
    expect(describeLocationType('IN_PASSENGER_VEHICLE')).toBe('Car')
    expect(describeLocationType('HOVERBOARD_RIDE')).toBe('Hoverboard ride')
  })
})

describe('validateLocationSample', () => {
  it('accepts valid visits and movements', () => {
    expect(() => validateLocationSample(visit)).not.toThrow()
    expect(() => validateLocationSample(movement)).not.toThrow()
    expect(() => validateLocationSample({ ...visit, metadata: { ...visit.metadata, placeId: null }, dedupeKey: buildLocationDedupeKey('import', 'location_visit', visit.startUtc, visit.endUtc!, null) })).not.toThrow()
  })

  it.each([
    ['another kind', visit, { measurementType: 'steps' }, /unknown kind/],
    ['a phone source', visit, { source: 'android_usage' }, /invalid source/],
    ['no end', visit, { endUtc: null }, /needs an end/],
    ['no offset', visit, { startOffsetMinutes: null }, /UTC offset/],
    ['an end before the start', visit, { endUtc: '2026-11-09T06:00:00.000Z' }, /end must be after the start/],
    ['more than 31 days', visit, { endUtc: '2026-12-11T07:00:00.000Z' }, /31 days/],
    ['a wrong visit duration', visit, { value: 1 }, /duration does not match/],
    ['visit in minutes', visit, { unit: 'min' }, /seconds/],
    ['bad place coordinates', visit, { metadata: { ...visit.metadata, lat: 95 } }, /place coordinates/],
    ['a bad probability', visit, { metadata: { ...visit.metadata, probability: 2 } }, /invalid probability/],
    ['a bad hierarchy level', visit, { metadata: { ...visit.metadata, hierarchyLevel: -1 } }, /hierarchy level/],
    ['an unknown format', visit, { metadata: { ...visit.metadata, format: 2 } }, /unknown location format/],
    ['a wrong key', visit, { dedupeKey: 'location:import:visit:x' }, /duplicate-detection key/],
    ['a negative distance', movement, { value: -1 }, /invalid distance/],
    ['movement in km', movement, { unit: 'km' }, /metres/],
    ['bad movement coordinates', movement, { metadata: { ...movement.metadata, endLng: 200 } }, /start or end coordinates/],
    ['no activity type', movement, { metadata: { ...movement.metadata, activityType: '' } }, /activity type/],
  ])('rejects %s', (_name, base, change, message) => {
    expect(() => validateLocationSample({ ...base, ...change } as typeof visit)).toThrow(message)
  })
})
