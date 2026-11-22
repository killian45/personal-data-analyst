import { db } from '../database/db'
import { LOCATION_TYPES } from '../location/location'
import { SCREEN_TIME_DAILY } from '../screenTime/screenTime'
import { fileTimestamp, saveFile } from '../files/saveFile'
import { loadDisplayTimezone } from '../settings/displayTimezone'
import { processSleep } from '../sleep/engine/processSleep'
import { getDeviceTimezone } from '../time/time'

import { buildExport } from './buildExport'
import type { ExportData, ExportFilters, ExportSource } from './buildExport'
import { toCsv, toJson, toMarkdown, toXlsx } from './serialise'

export type ExportFormat = 'csv' | 'xlsx' | 'json' | 'markdown'

/** Export formats, in display order (names and notes on screen: messages().exportPanel.formats). */
export const EXPORT_FORMATS: { id: ExportFormat }[] = [
  { id: 'xlsx' },
  { id: 'csv' },
  { id: 'json' },
  { id: 'markdown' },
]

/** Reads everything an export may need (deleted records excluded). */
export async function loadExportSource(): Promise<ExportSource> {
  return db.transaction('r', [db.habits, db.entries, db.sleepSessions, db.externalSamples], async () => {
    const habits = (await db.habits.toArray()).filter((habit) => habit.deletedAt === null)
    const entries = (await db.entries.toArray()).filter((entry) => entry.deletedAt === null)
    const sleepSessions = (await db.sleepSessions.toArray()).filter((session) => session.deletedAt === null)
    const screenTime = (await db.externalSamples.where('measurementType').equals(SCREEN_TIME_DAILY).toArray())
      .filter((sample) => sample.deletedAt === null)

    const location = (await db.externalSamples.where('measurementType').anyOf([...LOCATION_TYPES]).toArray())
      .filter((sample) => sample.deletedAt === null)

    return { habits, entries, sleepSessions, sleep: processSleep(sleepSessions), screenTime, location }
  })
}

export interface ExportFile {
  name: string
  type: string
  content: BlobPart
}

/** Turns export data into the files of the chosen format. */
export async function serialiseExport(
  data: ExportData,
  format: ExportFormat,
  habitNames: readonly string[] | 'all',
  exportedAt: Date,
): Promise<ExportFile[]> {
  const stamp = fileTimestamp(exportedAt)

  switch (format) {
    case 'csv':
      return data.tables.map((table) => ({
        name: `pda-export-${stamp}-${table.category}.csv`,
        type: 'text/csv;charset=utf-8',
        content: toCsv(table),
      }))
    case 'xlsx':
      return [{
        name: `pda-export-${stamp}.xlsx`,
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        content: await toXlsx(data, habitNames),
      }]
    case 'json':
      return [{ name: `pda-export-${stamp}.json`, type: 'application/json', content: toJson(data, habitNames) }]
    case 'markdown':
      return [{ name: `pda-export-${stamp}.md`, type: 'text/markdown;charset=utf-8', content: toMarkdown(data, habitNames) }]
  }
}

/**
 * Builds the export from the database and downloads its file(s).
 * Returns the export data so the interface can report what was exported.
 */
export async function runExport(filters: ExportFilters, format: ExportFormat): Promise<ExportData> {
  const exportedAt = new Date()
  const source = await loadExportSource()
  const data = buildExport(source, filters, {
    displayTimezone: await loadDisplayTimezone(),
    deviceTimezone: getDeviceTimezone(),
    exportedAt: exportedAt.toISOString(),
  })

  const habitNames = filters.habitIds === 'all'
    ? 'all'
    : source.habits.filter((habit) => filters.habitIds.includes(habit.id)).map((habit) => habit.name)

  for (const file of await serialiseExport(data, format, habitNames, exportedAt)) {
    await saveFile(file.content, file.type, file.name)
  }

  return data
}
