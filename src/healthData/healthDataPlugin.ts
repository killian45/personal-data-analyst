import { messages } from '../i18n'
/**
 * Health Connect plugin calls for activity and heart data (Android app
 * only; read only). Kept small, like src/import/healthConnectPlugin.ts.
 */

import { HealthConnect } from '@kiwi-health/capacitor-health-connect'
import type { RecordType } from '@kiwi-health/capacitor-health-connect'

import { HEALTH_SOURCES, IMPORT_KINDS } from './healthImport'

const PAGE_SIZE = 1000
const MAX_PAGES = 1000

const READ_TYPES = IMPORT_KINDS.map((kind) => HEALTH_SOURCES[kind].recordType as RecordType)

/** Shows Health Connect's permission screen for these types; returns the granted permissions. */
export async function requestHealthDataPermissions(): Promise<string[]> {
  return (await HealthConnect.requestHealthPermissions({ read: READ_TYPES, write: [], history: true })).grantedPermissions
}

export async function grantedHealthPermissions(): Promise<string[]> {
  return (await HealthConnect.checkHealthPermissions({ read: READ_TYPES, write: [], history: true })).grantedPermissions
}

/** Every record of one type between two instants (all pages). */
export async function readHealthRecords(recordType: string, startTime: Date, endTime: Date): Promise<unknown[]> {
  const records: unknown[] = []
  let pageToken: string | undefined
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await HealthConnect.readRecords({
      type: recordType as RecordType,
      timeRangeFilter: { type: 'between', startTime, endTime },
      ascendingOrder: true,
      pageSize: PAGE_SIZE,
      pageToken,
    })
    records.push(...result.records)
    pageToken = result.pageToken || undefined
    if (!pageToken) return records
  }
  throw new Error(messages().importText.tooManyPages)
}
