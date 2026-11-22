import { describe, expect, it } from 'vitest'

import { parseLatLng } from '../location/location'

import { parseTimeline, parseTimelineTime } from './timeline'
import { movement, timelineJson, visit } from './testTimeline'

describe('parseTimelineTime', () => {
  it('reads ISO times with offsets into UTC and keeps the offset', () => {
    expect(parseTimelineTime('2026-11-09T08:00:00.000+01:00')).toEqual({ utc: '2026-11-09T07:00:00.000Z', offsetMinutes: 60 })
    expect(parseTimelineTime('2026-11-09T08:00:00-05:30')).toEqual({ utc: '2026-11-09T13:30:00.000Z', offsetMinutes: -330 })
    expect(parseTimelineTime('2026-11-09T08:00:00Z')).toEqual({ utc: '2026-11-09T08:00:00.000Z', offsetMinutes: 0 })
  })

  it('uses the offset written in the time, not a separate field that disagrees (24 Oct 2026 case)', () => {
    const data = parseTimeline(timelineJson([
      visit('2026-10-24T20:03:00.000+02:00', '2026-10-25T15:06:00.000+01:00', { startTimeTimezoneUtcOffsetMinutes: 60 }),
    ]))
    expect(data.visits[0].start).toEqual({ utc: '2026-10-24T18:03:00.000Z', offsetMinutes: 120 })
    expect(data.visits[0].end).toEqual({ utc: '2026-10-25T14:06:00.000Z', offsetMinutes: 60 })
  })

  it('rejects times without an offset or unreadable times', () => {
    expect(parseTimelineTime('2026-11-09T08:00:00')).toBeNull()
    expect(parseTimelineTime('yesterday')).toBeNull()
    expect(parseTimelineTime(12)).toBeNull()
    expect(parseTimelineTime('2026-11-09T08:00:00+19:00')).toBeNull()
  })
})

describe('parseLatLng', () => {
  it('reads "lat°, lng°" at full precision', () => {
    expect(parseLatLng('48.1234567°, -2.1234567°')).toEqual({ lat: 48.1234567, lng: -2.1234567 })
    expect(parseLatLng('48.1, 2.2')).toEqual({ lat: 48.1, lng: 2.2 })
  })

  it('rejects out-of-range or malformed positions', () => {
    expect(parseLatLng('91°, 2°')).toBeNull()
    expect(parseLatLng('45°, 181°')).toBeNull()
    expect(parseLatLng('somewhere')).toBeNull()
    expect(parseLatLng(null)).toBeNull()
  })
})

describe('parseTimeline', () => {
  it('reads visits and movements, and counts what is deliberately not imported', () => {
    const data = parseTimeline(timelineJson([
      visit('2026-11-09T08:00:00.000+01:00', '2026-11-09T12:00:00.000+01:00'),
      movement('2026-11-09T12:00:00.000+01:00', '2026-11-09T12:20:00.000+01:00', { timelinePath: [{ point: '1°, 1°', time: 'x' }, { point: '1°, 1°', time: 'x' }] }),
      { startTime: '2026-11-09T12:20:00.000+01:00', endTime: '2026-11-09T13:00:00.000+01:00', timelinePath: [{ point: '1°, 1°', time: 'x' }] },
      { startTime: '2026-11-09T13:00:00.000+01:00', endTime: '2026-11-10T13:00:00.000+01:00', timelineMemory: { trip: {} } },
    ]))

    expect(data.visits).toEqual([{
      index: 0,
      start: { utc: '2026-11-09T07:00:00.000Z', offsetMinutes: 60 },
      end: { utc: '2026-11-09T11:00:00.000Z', offsetMinutes: 60 },
      placeId: 'PLACE_A',
      lat: 45.0000001,
      lng: 5.0000002,
      semanticType: 'HOME',
      probability: 0.9,
      placeProbability: 0.8,
      hierarchyLevel: 0,
    }])
    expect(data.movements).toEqual([expect.objectContaining({
      index: 1,
      activityType: 'CYCLING',
      distanceMeters: 3210.5,
      startLat: 45.0000001,
      endLng: -5.02,
      start: { utc: '2026-11-09T11:00:00.000Z', offsetMinutes: 60 },
    })])
    expect(data.invalid).toEqual([])
    expect(data.notImported).toEqual([
      { label: 'route points (detailed path)', count: 3 },
      { label: 'route-only segments', count: 2 },
      { label: 'trip summaries', count: 1 },
      { label: 'raw signals (GPS positions, motion, Wi-Fi scans)', count: 2 },
      { label: "Google's location profile (frequent places, commutes)", count: 1 },
    ])
  })

  it('lists unreadable segments with reasons instead of dropping them', () => {
    const data = parseTimeline(timelineJson([
      visit('2026-11-09T08:00:00', '2026-11-09T12:00:00.000+01:00'),
      visit('2026-11-09T12:00:00.000+01:00', '2026-11-09T08:00:00.000+01:00'),
      visit('2026-11-09T08:00:00.000+01:00', '2026-11-09T09:00:00.000+01:00', { visit: { topCandidate: { placeLocation: { latLng: 'nowhere' } } } }),
      movement('2026-11-09T08:00:00.000+01:00', '2026-11-09T09:00:00.000+01:00', { activity: { start: { latLng: '1°, 1°' }, end: { latLng: '1°, 1°' } } }),
      { startTime: '2026-11-09T08:00:00.000+01:00' },
    ]))
    expect(data.invalid.map((item) => item.reason)).toEqual([
      'start or end time missing or not readable',
      'ends before it starts',
      'the place has no readable coordinates',
      'missing or invalid distance',
      'neither a visit nor a movement',
    ])
  })

  it('keeps unknown types as given, and missing ones as UNKNOWN', () => {
    const data = parseTimeline(timelineJson([
      visit('2026-11-09T08:00:00.000+01:00', '2026-11-09T09:00:00.000+01:00', {
        visit: { topCandidate: { placeLocation: { latLng: '1°, 1°' } } },
      }),
      movement('2026-11-09T09:00:00.000+01:00', '2026-11-09T10:00:00.000+01:00', {
        activity: { start: { latLng: '1°, 1°' }, end: { latLng: '1°, 2°' }, distanceMeters: 10, topCandidate: { type: 'HOVERBOARD' } },
      }),
    ]))
    expect(data.visits[0]).toMatchObject({ placeId: null, semanticType: 'UNKNOWN', probability: null, hierarchyLevel: null })
    expect(data.movements[0]).toMatchObject({ activityType: 'HOVERBOARD', probability: null })
  })

  it('rejects files that are not a phone Timeline export', () => {
    expect(() => parseTimeline('{not json')).toThrow(/not valid JSON/)
    expect(() => parseTimeline('[]')).toThrow(/not a Google Timeline export/)
    expect(() => parseTimeline('{"timelineObjects": []}')).toThrow(/older Google Takeout location file/)
    expect(() => parseTimeline('{"locations": []}')).toThrow(/older Google Takeout location file/)
    expect(() => parseTimeline('{"something": 1}')).toThrow(/no "semanticSegments"/)
  })
})
