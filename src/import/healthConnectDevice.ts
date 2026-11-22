/**
 * Health Connect on the phone (Phase 4, docs/ANDROID_PLAN.md).
 *
 * Converts records returned by the Health Connect plugin
 * (@kiwi-health/capacitor-health-connect) into the same neutral
 * HealthConnectSleepRecord used by the Health Connect FILE import, so both
 * share one conversion (toSleepSession), one duplicate key
 * ("health_connect:id:<record id>") and one set of validation rules.
 *
 * Pure functions only; the plugin calls live in healthConnectPlugin.ts.
 */

import type { HealthConnectSleepRecord } from './healthConnect'

/** A SleepSession record as the plugin delivers it over the native bridge. */
export interface PluginSleepRecord {
  metadata?: {
    id?: unknown
    clientRecordId?: unknown
    clientRecordVersion?: unknown
    lastModifiedTime?: unknown
    dataOrigin?: unknown
  }
  startTime?: unknown
  startZoneOffset?: unknown
  endTime?: unknown
  endZoneOffset?: unknown
  title?: unknown
  notes?: unknown
  stages?: unknown
}

function timeMs(value: unknown, label: string): number {
  const ms = value instanceof Date ? value.getTime() : typeof value === 'string' ? Date.parse(value) : Number.NaN
  if (!Number.isFinite(ms)) throw new Error(`invalid ${label}`)
  return ms
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

/**
 * Parses a java.time.ZoneOffset id ("Z", "+01:00", "-05:30", "+01:00:00")
 * into seconds east of UTC. null when absent; throws when malformed.
 */
export function parseZoneOffsetSeconds(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  if (value === 'Z') return 0
  if (typeof value !== 'string') throw new Error('invalid UTC offset')
  const match = /^([+-])(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value)
  if (!match) throw new Error(`invalid UTC offset "${value}"`)
  const seconds = Number(match[2]) * 3600 + Number(match[3]) * 60 + Number(match[4] ?? 0)
  return match[1] === '-' ? -seconds : seconds
}

/** Plugin record → neutral Health Connect record. Throws on malformed input. */
export function fromPluginSleepRecord(record: PluginSleepRecord): HealthConnectSleepRecord {
  const id = optionalText(record.metadata?.id)
  if (!id) throw new Error('the record has no Health Connect id')

  const stages = Array.isArray(record.stages) ? record.stages : []
  const version = record.metadata?.clientRecordVersion

  return {
    rowId: 0,
    uuid: id,
    startMs: timeMs(record.startTime, 'start time'),
    startOffsetSeconds: parseZoneOffsetSeconds(record.startZoneOffset),
    endMs: timeMs(record.endTime, 'end time'),
    endOffsetSeconds: parseZoneOffsetSeconds(record.endZoneOffset),
    title: optionalText(record.title),
    notes: optionalText(record.notes),
    lastModifiedMs:
      record.metadata?.lastModifiedTime === undefined ? null : timeMs(record.metadata.lastModifiedTime, 'last modified time'),
    clientRecordId: optionalText(record.metadata?.clientRecordId),
    clientRecordVersion: typeof version === 'number' || typeof version === 'string' ? String(version) : null,
    recordingMethod: null,
    localDate: null,
    packageName: optionalText(record.metadata?.dataOrigin),
    appName: null,
    deviceManufacturer: null,
    deviceModel: null,
    stages: stages.map((stage: { startTime?: unknown; endTime?: unknown; stage?: unknown }) => ({
      startMs: timeMs(stage.startTime, 'stage time'),
      endMs: timeMs(stage.endTime, 'stage time'),
      type: typeof stage.stage === 'number' ? stage.stage : 0,
    })),
  }
}
