/** Builds made-up Google Timeline exports for tests (no real data). */
export function visit(start: string, end: string, changes: Record<string, unknown> = {}) {
  return {
    startTime: start,
    endTime: end,
    startTimeTimezoneUtcOffsetMinutes: 60,
    endTimeTimezoneUtcOffsetMinutes: 60,
    visit: {
      hierarchyLevel: 0,
      probability: 0.9,
      topCandidate: { placeId: 'PLACE_A', semanticType: 'HOME', probability: 0.8, placeLocation: { latLng: '45.0000001°, 5.0000002°' } },
    },
    ...changes,
  }
}

export function movement(start: string, end: string, changes: Record<string, unknown> = {}) {
  return {
    startTime: start,
    endTime: end,
    activity: {
      start: { latLng: '45.0000001°, 5.0000002°' },
      end: { latLng: '45.0100000°, -5.0200000°' },
      distanceMeters: 3210.5,
      probability: 0.95,
      topCandidate: { type: 'CYCLING', probability: 0.7 },
    },
    ...changes,
  }
}

export function timelineJson(segments: unknown[], extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    semanticSegments: segments,
    rawSignals: [{ position: { LatLng: '1°, 1°' } }, { wifiScan: { devicesRecords: [{ mac: 1, rawRssi: -50 }] } }],
    userLocationProfile: { frequentPlaces: [] },
    ...extra,
  })
}
