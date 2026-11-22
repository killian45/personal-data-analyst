import type { Database } from 'sql.js'
import { messages } from '../i18n'

import { buildSleepDedupeKey } from '../database/sleepSessions'
import { initialSyncFields } from '../database/sync'
import type { SleepSession, SleepStageType } from '../database/types'
import {
  validateSleepStages,
  validateSleepTimes,
  validateUtcOffsetMinutes,
} from '../database/validation'

/**
 * Reads sleep sessions from a Health Connect export database
 * ("health_connect_export.db" inside the exported zip).
 *
 * Privacy: only the sleep tables and the app/device name tables are read.
 * Other record types (heart rate, steps, exercise routes, medical data...)
 * are never read; for record tables only their row count is reported, so
 * the user knows what was not imported.
 *
 * Health Connect storage conventions (export schema):
 * - times are milliseconds since 1970 (UTC);
 * - zone offsets are seconds east of UTC;
 * - record ids ("uuid") are 16-byte blobs;
 * - stage types are numbers: 0 unknown, 1 awake, 2 sleeping, 3 out of bed,
 *   4 light, 5 deep, 6 REM, 7 awake in bed.
 */

export const STAGE_CODES: Record<number, SleepStageType> = {
  0: 'unknown',
  1: 'awake',
  2: 'sleeping',
  3: 'out_of_bed',
  4: 'light',
  5: 'deep',
  6: 'rem',
  7: 'awake_in_bed',
}

export interface HealthConnectSleepRecord {
  rowId: number
  uuid: string | null
  startMs: number
  startOffsetSeconds: number | null
  endMs: number
  endOffsetSeconds: number | null
  title: string | null
  notes: string | null
  lastModifiedMs: number | null
  clientRecordId: string | null
  clientRecordVersion: string | null
  recordingMethod: number | null
  localDate: number | null
  packageName: string | null
  appName: string | null
  deviceManufacturer: string | null
  deviceModel: string | null
  stages: { startMs: number; endMs: number; type: number }[]
}

export interface HealthConnectSleepData {
  records: HealthConnectSleepRecord[]
  /** Other record types in the export with their row counts (not imported). */
  otherData: { label: string; count: number }[]
}

const REQUIRED_SESSION_COLUMNS = ['row_id', 'uuid', 'start_time', 'start_zone_offset', 'end_time', 'end_zone_offset']
const REQUIRED_STAGE_COLUMNS = ['parent_key', 'stage_start_time', 'stage_end_time', 'stage_type']

function columns(db: Database, table: string): Set<string> {
  const result = db.exec(`pragma table_info("${table.replaceAll('"', '""')}")`)
  return new Set((result[0]?.values ?? []).map((row) => String(row[1])))
}

function tables(db: Database): string[] {
  const result = db.exec("select name from sqlite_master where type = 'table'")
  return (result[0]?.values ?? []).map((row) => String(row[0]))
}

function rows(db: Database, sql: string): Record<string, unknown>[] {
  const statement = db.prepare(sql)
  const result: Record<string, unknown>[] = []

  try {
    while (statement.step()) {
      result.push(statement.getAsObject() as Record<string, unknown>)
    }
  } finally {
    statement.free()
  }

  return result
}

function uuidText(value: unknown): string | null {
  if (!(value instanceof Uint8Array) || value.length !== 16) {
    return null
  }

  const hex = [...value].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)
const str = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null)

/** "steps_record_table" → "steps". */
function recordLabel(table: string): string {
  return table.replace(/_record_table$/, '').replaceAll('_', ' ')
}

export function readHealthConnectSleep(db: Database): HealthConnectSleepData {
  const names = new Set(tables(db))

  if (!names.has('sleep_session_record_table') || !names.has('sleep_stages_table')) {
    throw new Error(messages().importText.sleepFile.notExport)
  }

  const sessionColumns = columns(db, 'sleep_session_record_table')
  const stageColumns = columns(db, 'sleep_stages_table')
  const missing = [
    ...REQUIRED_SESSION_COLUMNS.filter((column) => !sessionColumns.has(column)),
    ...REQUIRED_STAGE_COLUMNS.filter((column) => !stageColumns.has(column)),
  ]

  if (missing.length > 0) {
    throw new Error(messages().importText.sleepFile.unexpectedFormat(missing.join(', ')))
  }

  const optional = (column: string, table = 's') => (sessionColumns.has(column) ? `${table}.${column}` : 'null')
  const hasApps = names.has('application_info_table') && sessionColumns.has('app_info_id')
  const hasDevices = names.has('device_info_table') && sessionColumns.has('device_info_id')

  const sessionRows = rows(
    db,
    `select s.row_id, s.uuid, s.start_time, s.start_zone_offset, s.end_time, s.end_zone_offset,
            ${optional('title')} as title, ${optional('notes')} as notes,
            ${optional('last_modified_time')} as last_modified_time,
            ${optional('client_record_id')} as client_record_id,
            ${optional('client_record_version')} as client_record_version,
            ${optional('recording_method')} as recording_method,
            ${optional('local_date')} as local_date,
            ${hasApps ? 'a.package_name' : 'null'} as package_name,
            ${hasApps ? 'a.app_name' : 'null'} as app_name,
            ${hasDevices ? 'd.manufacturer' : 'null'} as manufacturer,
            ${hasDevices ? 'd.model' : 'null'} as model
     from sleep_session_record_table s
     ${hasApps ? 'left join application_info_table a on a.row_id = s.app_info_id' : ''}
     ${hasDevices ? 'left join device_info_table d on d.row_id = s.device_info_id' : ''}
     order by s.start_time, s.row_id`,
  )

  const stagesByParent = new Map<number, { startMs: number; endMs: number; type: number }[]>()

  for (const stage of rows(db, 'select parent_key, stage_start_time, stage_end_time, stage_type from sleep_stages_table order by parent_key, stage_start_time')) {
    const parent = num(stage.parent_key)

    if (parent !== null) {
      stagesByParent.set(parent, [
        ...(stagesByParent.get(parent) ?? []),
        { startMs: Number(stage.stage_start_time), endMs: Number(stage.stage_end_time), type: Number(stage.stage_type) },
      ])
    }
  }

  const records = sessionRows.map((row) => {
    const rowId = Number(row.row_id)

    return {
      rowId,
      uuid: uuidText(row.uuid),
      startMs: Number(row.start_time),
      startOffsetSeconds: num(row.start_zone_offset),
      endMs: Number(row.end_time),
      endOffsetSeconds: num(row.end_zone_offset),
      title: str(row.title),
      notes: str(row.notes),
      lastModifiedMs: num(row.last_modified_time),
      clientRecordId: str(row.client_record_id),
      clientRecordVersion: row.client_record_version === null || row.client_record_version === undefined ? null : String(row.client_record_version),
      recordingMethod: num(row.recording_method),
      localDate: num(row.local_date),
      packageName: str(row.package_name),
      appName: str(row.app_name),
      deviceManufacturer: str(row.manufacturer),
      deviceModel: str(row.model),
      stages: stagesByParent.get(rowId) ?? [],
    }
  })

  // Other record types: row counts only, never their content.
  const otherData = [...names]
    .filter((name) => name.endsWith('_record_table') && name !== 'sleep_session_record_table')
    .sort()
    .map((name) => ({ label: recordLabel(name), count: Number(db.exec(`select count(*) from "${name}"`)[0]?.values[0][0] ?? 0) }))
    .filter((item) => item.count > 0)

  return { records, otherData }
}

function isoFromMs(ms: number, label: string): string {
  const date = new Date(ms)

  if (!Number.isFinite(ms) || Number.isNaN(date.getTime())) {
    throw new Error(`invalid ${label}`)
  }

  return date.toISOString()
}

function offsetMinutes(seconds: number | null, label: string): number | null {
  if (seconds === null) {
    return null
  }

  if (seconds % 60 !== 0) {
    throw new Error(`${label} UTC offset is not a whole number of minutes`)
  }

  return validateUtcOffsetMinutes(seconds / 60)
}

/**
 * Converts one Health Connect record into an original sleep session.
 * Throws an Error with a short reason when the record is invalid.
 * Original values are preserved in metadata.healthConnect.
 */
export function toSleepSession(
  record: HealthConnectSleepRecord,
  options: { id: string; importedAt: string },
): SleepSession {
  const startUtc = isoFromMs(record.startMs, 'start time')
  const endUtc = isoFromMs(record.endMs, 'end time')

  // Checked here (not by reading validateSleepTimes' message, which is translated).
  if (Date.parse(endUtc) <= Date.parse(startUtc)) throw new Error(messages().validation.sessionNotEnd)
  try {
    validateSleepTimes(startUtc, endUtc)
  } catch (caughtError) {
    const message = caughtError instanceof Error ? caughtError.message : messages().validation.invalidTimes
    throw new Error(message.replace(/\.$/, '').toLowerCase())
  }

  const startOffsetMinutes = offsetMinutes(record.startOffsetSeconds, 'start')
  const endOffsetMinutes = offsetMinutes(record.endOffsetSeconds, 'end')

  if (startOffsetMinutes === null) {
    throw new Error('the record has no start UTC offset')
  }

  const unknownStageCodes = [...new Set(record.stages.map((stage) => stage.type).filter((code) => !(code in STAGE_CODES)))]
  const stages = validateSleepStages(
    record.stages.map((stage) => ({
      start: isoFromMs(stage.startMs, 'stage time'),
      end: isoFromMs(stage.endMs, 'stage time'),
      stage: STAGE_CODES[stage.type] ?? 'unknown',
    })),
  )

  return {
    id: options.id,
    source: 'health_connect',
    externalId: record.uuid,
    sourceApp: record.packageName,
    dedupeKey: buildSleepDedupeKey({ source: 'health_connect', id: options.id, externalId: record.uuid, startUtc, endUtc }),
    startUtc,
    endUtc,
    timezone: null,
    startOffsetMinutes,
    endOffsetMinutes,
    stages,
    reportedSleepMs: null,
    comment: null,
    importedAt: options.importedAt,
    metadata: {
      healthConnect: {
        uuid: record.uuid,
        title: record.title,
        notes: record.notes,
        appName: record.appName,
        packageName: record.packageName,
        deviceManufacturer: record.deviceManufacturer,
        deviceModel: record.deviceModel,
        recordingMethod: record.recordingMethod,
        lastModifiedTime: record.lastModifiedMs === null ? null : new Date(record.lastModifiedMs).toISOString(),
        clientRecordId: record.clientRecordId,
        clientRecordVersion: record.clientRecordVersion,
        localDate: record.localDate,
        startZoneOffsetSeconds: record.startOffsetSeconds,
        endZoneOffsetSeconds: record.endOffsetSeconds,
        ...(unknownStageCodes.length > 0 ? { unknownStageCodes } : {}),
      },
    },
    ...initialSyncFields(),
    createdAt: options.importedAt,
    updatedAt: options.importedAt,
    deletedAt: null,
  }
}
