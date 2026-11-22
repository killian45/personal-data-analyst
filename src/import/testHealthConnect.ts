import { loadSqlJs } from './sqlite'

/**
 * Builds a synthetic Health Connect export database for tests, using the
 * same table and column names as real exports (no real data).
 */
export interface FakeSession {
  uuid?: string | null
  start: string
  end: string
  startOffsetSeconds?: number | null
  endOffsetSeconds?: number | null
  lastModified?: string
  title?: string | null
  notes?: string | null
  appRowId?: number
  stages?: { start: string; end: string; type: number }[]
}

export async function buildHealthConnectDb(
  sessions: FakeSession[],
  options: { otherCounts?: Record<string, number>; omitStagesTable?: boolean; omitColumn?: string } = {},
): Promise<Uint8Array> {
  const SQL = await loadSqlJs()
  const db = new SQL.Database()

  const sessionColumns = [
    'row_id INTEGER PRIMARY KEY', 'uuid BLOB', 'last_modified_time INTEGER', 'client_record_id TEXT',
    'client_record_version TEXT', 'device_info_id INTEGER', 'app_info_id INTEGER', 'recording_method INTEGER',
    'dedupe_hash BLOB', 'start_time INTEGER', 'start_zone_offset INTEGER', 'end_time INTEGER',
    'end_zone_offset INTEGER', 'local_date INTEGER', 'notes TEXT', 'title TEXT', 'device_data_provider_id INTEGER',
  ].filter((column) => !column.startsWith(`${options.omitColumn} `))

  db.run(`create table sleep_session_record_table (${sessionColumns.join(', ')})`)
  if (!options.omitStagesTable) {
    db.run('create table sleep_stages_table (parent_key INTEGER, stage_start_time INTEGER, stage_end_time INTEGER, stage_type INTEGER)')
  }
  db.run('create table application_info_table (row_id INTEGER PRIMARY KEY, package_name TEXT, app_name TEXT, app_icon BLOB, record_types_used TEXT, device_info_id INTEGER)')
  db.run('create table device_info_table (row_id INTEGER PRIMARY KEY, manufacturer TEXT, model TEXT, device_type INTEGER, device_id TEXT, display_name TEXT, udi TEXT)')
  db.run("insert into application_info_table (row_id, package_name, app_name) values (1, 'com.example.sleep', 'Example Sleep')")
  db.run("insert into device_info_table (row_id, manufacturer, model) values (1, 'Example', 'Watch 1')")
  db.run('create table medical_resource_table (medical_resource_row_id INTEGER, fhir_data TEXT)')
  db.run("insert into medical_resource_table values (1, 'never read')")

  for (const [table, count] of Object.entries(options.otherCounts ?? {})) {
    db.run(`create table ${table} (row_id INTEGER PRIMARY KEY, uuid BLOB)`)
    for (let index = 0; index < count; index += 1) {
      db.run(`insert into ${table} (row_id) values (${index + 1})`)
    }
  }

  sessions.forEach((session, index) => {
    const rowId = index + 1
    const uuid = session.uuid === undefined
      ? `00000000000040008000${String(rowId).padStart(12, '0')}`
      : session.uuid
    const values: Record<string, unknown> = {
      row_id: rowId,
      uuid: uuid === null ? null : Uint8Array.from(uuid.match(/../g)!.map((byte) => parseInt(byte, 16))),
      last_modified_time: Date.parse(session.lastModified ?? '2026-11-09T08:00:00.000Z'),
      client_record_id: null,
      client_record_version: '1',
      device_info_id: 1,
      app_info_id: session.appRowId ?? 1,
      recording_method: 2,
      dedupe_hash: null,
      start_time: Date.parse(session.start),
      start_zone_offset: session.startOffsetSeconds === undefined ? 3600 : session.startOffsetSeconds,
      end_time: Date.parse(session.end),
      end_zone_offset: session.endOffsetSeconds === undefined ? 3600 : session.endOffsetSeconds,
      local_date: null,
      notes: session.notes ?? null,
      title: session.title ?? null,
      device_data_provider_id: null,
    }
    const used = Object.keys(values).filter((column) => column !== options.omitColumn)
    db.run(
      `insert into sleep_session_record_table (${used.join(', ')}) values (${used.map(() => '?').join(', ')})`,
      used.map((column) => values[column]) as never,
    )

    for (const stage of options.omitStagesTable ? [] : session.stages ?? []) {
      db.run('insert into sleep_stages_table values (?, ?, ?, ?)', [rowId, Date.parse(stage.start), Date.parse(stage.end), stage.type])
    }
  })

  const bytes = db.export()
  db.close()
  return bytes
}
