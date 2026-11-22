import type { ExternalSample } from '../database/types'
import { planLocationImport } from '../import/locationImport'
import { movement, timelineJson, visit } from '../import/testTimeline'

/**
 * Made-up location records for tests (Paris offset +01:00): a 4-hour HOME
 * visit on 9 Nov 2026 08:00–12:00 and a 3.2 km cycling movement 12:00–12:20.
 */
export function locationSamples(ids: [string, string] = ['visit-1', 'move-1']): ExternalSample[] {
  let next = 0
  return planLocationImport(
    {
      fileName: 'Timeline.json',
      text: timelineJson([
        visit('2026-11-09T08:00:00.000+01:00', '2026-11-09T12:00:00.000+01:00'),
        movement('2026-11-09T12:00:00.000+01:00', '2026-11-09T12:20:00.000+01:00'),
      ]),
    },
    [],
    { importedAt: '2026-11-11T09:00:00.000Z', newId: () => ids[next++] },
  ).toAdd
}
