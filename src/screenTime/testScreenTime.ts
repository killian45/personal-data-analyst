import type { ExternalSample } from '../database/types'

import { buildScreenTimeDedupeKey, localDayBoundsUtc } from './screenTime'

/** A valid made-up screen-time day (Paris) for tests. */
export function screenTimeSample(id: string, localDate = '2026-11-09', changes: Partial<ExternalSample> = {}): ExternalSample {
  const { startUtc, endUtc } = localDayBoundsUtc(localDate, 'Europe/Paris')
  return {
    id,
    source: 'import',
    externalId: null,
    sourceApp: 'App Usage',
    dedupeKey: buildScreenTimeDedupeKey('import', localDate),
    measurementType: 'screen_time_daily',
    value: 4380,
    unit: 's',
    startUtc,
    endUtc,
    timezone: 'Europe/Paris',
    startOffsetMinutes: 60,
    importedAt: '2026-11-10T08:00:00.000Z',
    metadata: {
      format: 1,
      localDate,
      apps: [{ name: 'Messages', seconds: 3780, opens: 12 }, { name: 'Maps', seconds: 600, opens: 3 }],
      fileFormat: 'app_usage_usage_history_csv',
      fileName: `AUM_V4_Usage_${localDate}.csv`,
      exportCreatedLocal: null,
    },
    syncStatus: 'pending',
    revision: 1,
    syncedRevision: null,
    createdAt: '2026-11-10T08:00:00.000Z',
    updatedAt: '2026-11-10T08:00:00.000Z',
    deletedAt: null,
    ...changes,
  }
}
