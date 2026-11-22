import { messages } from '../i18n'
/**
 * Thin wrapper around the Health Connect plugin (Android app only).
 * Kept small so the plugin can be replaced (docs/ANDROID_PLAN.md §3.3).
 * Sleep is read only; nothing is ever written to Health Connect.
 */

import { Capacitor } from '@capacitor/core'
import { HealthConnect } from '@kiwi-health/capacitor-health-connect'

import type { PluginSleepRecord } from './healthConnectDevice'

export const READ_SLEEP_PERMISSION = 'android.permission.health.READ_SLEEP'
export const READ_HISTORY_PERMISSION = 'android.permission.health.READ_HEALTH_DATA_HISTORY'

const PAGE_SIZE = 1000
const MAX_PAGES = 500

/** True only inside the Android app. */
export function isHealthConnectPlatform(): boolean {
  return Capacitor.getPlatform() === 'android'
}

export type HealthConnectStatus = 'available' | 'not-installed' | 'not-supported'

export async function healthConnectStatus(): Promise<HealthConnectStatus> {
  const { availability } = await HealthConnect.checkAvailability()
  return availability === 'Available' ? 'available' : availability === 'NotInstalled' ? 'not-installed' : 'not-supported'
}

export interface SleepPermission {
  sleep: boolean
  /** Access to data older than 30 days (null: not offered by this Health Connect version). */
  history: boolean | null
}

function toPermission(result: { grantedPermissions: string[]; historyAvailable?: boolean }): SleepPermission {
  return {
    sleep: result.grantedPermissions.includes(READ_SLEEP_PERMISSION),
    history: result.historyAvailable === false ? null : result.grantedPermissions.includes(READ_HISTORY_PERMISSION),
  }
}

/** Shows Health Connect's permission screen (read sleep + past data). */
export async function requestSleepPermission(): Promise<SleepPermission> {
  return toPermission(await HealthConnect.requestHealthPermissions({ read: ['SleepSession'], write: [], history: true }))
}

export async function checkSleepPermission(): Promise<SleepPermission> {
  return toPermission(await HealthConnect.checkHealthPermissions({ read: ['SleepSession'], write: [], history: true }))
}

/** Reads every sleep session Health Connect allows this app to read. */
export async function readAllSleepSessions(now = new Date()): Promise<PluginSleepRecord[]> {
  const records: PluginSleepRecord[] = []
  let pageToken: string | undefined
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await HealthConnect.readRecords({
      type: 'SleepSession',
      timeRangeFilter: { type: 'before', time: now },
      ascendingOrder: true,
      pageSize: PAGE_SIZE,
      pageToken,
    })
    records.push(...(result.records as unknown as PluginSleepRecord[]))
    pageToken = result.pageToken || undefined
    if (!pageToken) return records
  }
  throw new Error(messages().importText.tooManyPages)
}
