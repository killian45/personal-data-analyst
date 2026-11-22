import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'

import type { Entry, Habit, SleepSession } from '../database/types'
import { buildScreenTimeDedupeKey } from '../screenTime/screenTime'
import { locationSamples } from '../location/testLocation'
import { screenTimeSample } from '../screenTime/testScreenTime'
import { processSleep } from '../sleep/engine/processSleep'

import { buildExport } from './buildExport'
import type { ExportFilters, ExportSource } from './buildExport'
import { describeExport, toCsv, toJson, toMarkdown, toXlsx } from './serialise'

const RECORD = {
  syncStatus: 'pending' as const,
  revision: 1,
  syncedRevision: null,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
  deletedAt: null,
}
const HABIT = { ...RECORD, color: '#2563eb', archived: false, sortOrder: 0 }
const water: Habit = { ...HABIT, id: 'water', name: 'Water', type: 'number', unit: 'ml', labelOptions: null, dailyAggregation: 'sum', target: null }
const gym: Habit = { ...HABIT, id: 'gym', name: 'Gym', type: 'checkbox', unit: null, labelOptions: null, archived: true }
const reading: Habit = { ...HABIT, id: 'reading', name: 'Reading', type: 'stopwatch', unit: null, labelOptions: null }

const base = { ...RECORD, source: 'manual' as const, externalId: null, comment: null, timezone: 'Europe/Paris' }
const entries: Entry[] = [
  // 23:30 UTC on the 8th = 00:30 on the 9th in Paris
  { ...base, id: 'e1', habitId: 'water', habitType: 'number', occurredStart: '2026-11-08T23:30:00.000Z', occurredEnd: null, value: 500, comment: 'Late, "big" glass' },
  { ...base, id: 'e2', habitId: 'gym', habitType: 'checkbox', occurredStart: '2026-11-09T17:00:00.000Z', occurredEnd: null, value: false },
  {
    ...base, id: 'e3', habitId: 'reading', habitType: 'stopwatch', occurredStart: '2026-11-10T19:00:00.000Z', occurredEnd: '2026-11-10T20:00:00.000Z',
    value: { segments: [{ start: '2026-11-10T19:00:00.000Z', end: '2026-11-10T19:30:00.000Z' }, { start: '2026-11-10T19:40:00.000Z', end: '2026-11-10T20:00:00.000Z' }] },
  },
  { ...base, id: 'e4', habitId: 'water', habitType: 'number', occurredStart: '2026-11-10T08:00:00.000Z', occurredEnd: null, value: 250, deletedAt: '2026-11-10T09:00:00.000Z' },
]

const session = (id: string, startUtc: string, endUtc: string): SleepSession => ({
  ...RECORD, id, source: 'manual', externalId: null, sourceApp: null, dedupeKey: `manual:${id}`, startUtc, endUtc,
  timezone: 'Europe/Paris', startOffsetMinutes: null, endOffsetMinutes: null, stages: [], reportedSleepMs: null,
  comment: null, importedAt: null, metadata: null,
})
const sleepSessions = [
  session('night', '2026-11-08T22:30:00.000Z', '2026-11-09T06:00:00.000Z'),
  session('nap', '2026-11-09T12:00:00.000Z', '2026-11-09T13:00:00.000Z'),
]

const source: ExportSource = { habits: [water, gym, reading], entries, sleepSessions, sleep: processSleep(sleepSessions), screenTime: [], location: [] }
const options = { displayTimezone: 'event' as const, deviceTimezone: 'Europe/Paris', exportedAt: '2026-11-10T12:00:00.000Z' }
const allData: ExportFilters = { range: null, habitIds: 'all', categories: ['entries', 'sleepSessions', 'nights'] }

describe('buildExport', () => {
  it('exports habit entries with local date/time, timezones, UTC, units and sources', () => {
    const [table] = buildExport(source, { ...allData, categories: ['entries'] }, options).tables

    expect(table.rows).toEqual([
      expect.objectContaining({
        date: '2026-11-09', time: '00:30', timezone: 'Europe/Paris', eventTimezone: 'Europe/Paris',
        startUtc: '2026-11-08T23:30:00.000Z', endUtc: null, habit: 'Water', type: 'Number', value: 500, unit: 'ml',
        durationMinutes: null, source: 'Manual', comment: 'Late, "big" glass', id: 'e1',
      }),
      expect.objectContaining({ habit: 'Gym', type: 'Checkbox', value: false, unit: null }),
      // Stopwatch: active time 30 + 20 = 50 minutes in 2 periods; no value.
      expect.objectContaining({ habit: 'Reading', type: 'Stopwatch', value: null, durationMinutes: 50, periods: 2, endUtc: '2026-11-10T20:00:00.000Z' }),
    ])
    // The deleted entry is not exported.
    expect(table.rows.map((row) => row.id)).not.toContain('e4')
  })

  it('follows the display timezone setting for date and time columns', () => {
    const [table] = buildExport(source, { ...allData, categories: ['entries'] }, { ...options, displayTimezone: 'UTC' }).tables

    expect(table.rows[0]).toMatchObject({ date: '2026-11-08', time: '23:30', timezone: 'UTC', eventTimezone: 'Europe/Paris' })
  })

  it('filters by local date range and by habit', () => {
    const [byDate] = buildExport(source, { ...allData, categories: ['entries'], range: { start: '2026-11-09', end: '2026-11-09' } }, options).tables
    expect(byDate.rows.map((row) => row.id)).toEqual(['e1', 'e2'])

    const [byHabit] = buildExport(source, { ...allData, categories: ['entries'], habitIds: ['reading'] }, options).tables
    expect(byHabit.rows.map((row) => row.id)).toEqual(['e3'])
  })

  it('exports recorded sleep sessions and calculated nights and naps separately', () => {
    const data = buildExport(source, { ...allData, categories: ['nights', 'sleepSessions'] }, options)

    expect(data.tables.map((table) => table.title)).toEqual(['Sleep sessions (recorded)', 'Nights and naps (calculated by the app)'])
    expect(data.tables[0].rows[0]).toMatchObject({
      bedDate: '2026-11-08', bedTime: '23:30', wakeDate: '2026-11-09', wakeTime: '07:00',
      timeInBedMinutes: 450, stages: 0, source: 'Manual', id: 'night',
    })
    expect(data.tables[1].rows).toEqual([
      expect.objectContaining({ kind: 'Night', nightDate: '2026-11-08', bedtime: '23:30', wakeTime: '07:00', bedtimeHours: 23.5, wakeHours: 31, sleepMinutes: 450, method: 'time in bed', sessionIds: 'night' }),
      expect.objectContaining({ kind: 'Nap', nightDate: '2026-11-09', bedtime: '13:00', wakeTime: '14:00', bedtimeHours: null, sleepMinutes: 60 }),
    ])
  })

  it('screen time: one row per day and source, marks the Dashboard\'s choice, and per-app rows', () => {
    const withScreenTime: ExportSource = {
      ...source,
      screenTime: [
        screenTimeSample('file-9', '2026-11-09', { value: 4380 }),
        screenTimeSample('phone-9', '2026-11-09', {
          source: 'android_usage',
          sourceApp: 'Android (Usage access)',
          dedupeKey: buildScreenTimeDedupeKey('android_usage', '2026-11-09'),
          value: 4410,
          metadata: { format: 1, localDate: '2026-11-09', apps: [{ name: 'Chat', package: 'com.chat', seconds: 4410, opens: null }] },
        }),
        screenTimeSample('file-8', '2026-11-08', { value: 90 }),
      ],
    }
    const [days, apps] = buildExport(withScreenTime, { ...allData, categories: ['screenTime', 'screenTimeApps'] }, options).tables

    expect(days.rows.map((row) => [row.date, row.minutes, row.apps, row.source, row.usedOnDashboard])).toEqual([
      ['2026-11-08', 1.5, 2, 'Import', 'yes'],
      ['2026-11-09', 73.5, 1, 'Phone', 'yes'], // 4410 s = 73.5 min
      ['2026-11-09', 73, 2, 'Import', 'no'],
    ])
    expect(days.rows[1]).toMatchObject({ timezone: 'Europe/Paris', startUtc: '2026-11-08T23:00:00.000Z', id: 'phone-9' })
    expect(apps.rows.filter((row) => row.date === '2026-11-09')).toEqual([
      { date: '2026-11-09', source: 'Phone', app: 'Chat', package: 'com.chat', minutes: 73.5, opens: null, id: 'phone-9' },
      { date: '2026-11-09', source: 'Import', app: 'Messages', package: null, minutes: 63, opens: 12, id: 'file-9' },
      { date: '2026-11-09', source: 'Import', app: 'Maps', package: null, minutes: 10, opens: 3, id: 'file-9' },
    ])

    const ranged = buildExport(withScreenTime, { ...allData, categories: ['screenTime'], range: { start: '2026-11-09', end: '2026-11-09' } }, options)
    expect(ranged.tables[0].rows).toHaveLength(2)
  })

  it('location: visits and movements tables with coordinates, times in the display timezone', () => {
    const withLocation: ExportSource = { ...source, location: locationSamples() }
    const [visits, movements] = buildExport(withLocation, { ...allData, categories: ['locationVisits', 'locationMovements'] }, { ...options, displayTimezone: 'event' }).tables

    expect(visits.rows).toEqual([expect.objectContaining({
      startDate: '2026-11-09', startTime: '08:00', endTime: '12:00', timezone: '+01:00', offset: '+01:00',
      startUtc: '2026-11-09T07:00:00.000Z', durationMinutes: 240, placeType: 'Home', placeTypeCode: 'HOME',
      placeId: 'PLACE_A', lat: 45.0000001, lng: 5.0000002, probability: 0.9, placeProbability: 0.8, hierarchyLevel: 0,
      source: 'Import (Google Timeline)', id: 'visit-1',
    })])
    expect(movements.rows).toEqual([expect.objectContaining({
      startTime: '12:00', durationMinutes: 20, activity: 'Cycling', activityCode: 'CYCLING', distanceKm: 3.211,
      startLat: 45.0000001, endLng: -5.02, typeProbability: 0.7, id: 'move-1',
    })])

    const otherDay = buildExport(withLocation, { ...allData, categories: ['locationVisits'], range: { start: '2026-11-10', end: '2026-11-10' } }, options)
    expect(otherDay.tables[0].rows).toEqual([])
  })

  it('exports only the chosen data types, in a fixed order', () => {
    expect(buildExport(source, { ...allData, categories: ['nights', 'entries'] }, options).tables.map((t) => t.category)).toEqual(['entries', 'nights'])
  })
})

describe('serialisers', () => {
  const data = buildExport(source, allData, options)
  const entriesTable = data.tables[0]

  it('CSV: BOM, header, CRLF, quoting and empty cells for missing values', () => {
    const csv = toCsv(entriesTable)
    const lines = csv.slice(1).split('\r\n')

    expect(csv.startsWith('﻿')).toBe(true)
    expect(lines[0]).toBe('Date,Time,Timezone of date/time,Event timezone,Start (UTC),End (UTC),Habit,Type,Value,Unit,Duration (min),Periods,Source,Comment,Entry ID,Created (UTC),Updated (UTC)')
    expect(lines[1]).toContain(',Water,Number,500,ml,,,Manual,"Late, ""big"" glass",e1,')
    expect(lines.at(-1)).toBe('')
  })

  it('CSV: prevents formula injection in text but keeps negative numbers', () => {
    const csv = toCsv({
      category: 'entries',
      title: 't',
      columns: [{ key: 'a', header: 'A' }, { key: 'b', header: 'B' }],
      rows: [{ a: '=HYPERLINK("x")', b: -5 }, { a: '+1', b: null }, { a: '@cmd', b: true }],
    })

    expect(csv.slice(1).split('\r\n').slice(1, 4)).toEqual([`"'=HYPERLINK(""x"")",-5`, `'+1,`, `'@cmd,true`])
  })

  it('Markdown: metadata, escaped tables and empty tables', () => {
    const md = toMarkdown({ ...data, tables: [...data.tables, { ...entriesTable, title: 'Empty', rows: [] }] }, 'all')

    expect(md).toContain('# Personal Data Analyst export')
    expect(md).toContain('- Date range: all dates')
    expect(md).toContain('## Habit entries')
    expect(md).toContain('| Date | Time |')
    expect(md).toContain('## Empty\n\n_No records._')

    const escaped = toMarkdown({ ...data, tables: [{ ...entriesTable, rows: [{ ...entriesTable.rows[0], comment: 'a | b\nc' }] }] }, 'all')
    expect(escaped).toContain('a \\| b<br>c')
  })

  it('JSON: format, notes and typed rows per data type', () => {
    const json = JSON.parse(toJson(data, ['Water']))

    expect(json.format).toBe('personal-data-analyst-export')
    expect(json.notes).toContain('Habits: Water')
    expect(Object.keys(json.tables)).toEqual(['entries', 'sleepSessions', 'nights'])
    expect(json.tables.entries.rows[1].value).toBe(false)
  })

  it('XLSX: About sheet, one sheet per table, typed cells, text never a formula', async () => {
    const withFormulaText = {
      ...data,
      tables: data.tables.map((table, index) =>
        index === 0 ? { ...table, rows: [{ ...table.rows[0], comment: '=1+1' }, ...table.rows.slice(1)] } : table,
      ),
    }

    const workbook = XLSX.read(await toXlsx(withFormulaText, 'all'), { type: 'array' })

    expect(workbook.SheetNames).toEqual(['About', 'Habit entries', 'Sleep sessions (recorded)', 'Nights and naps (calculated)'])

    const sheet = workbook.Sheets['Habit entries']
    expect(sheet.A1.v).toBe('Date')
    expect(sheet.I2).toMatchObject({ t: 'n', v: 500 })
    expect(sheet.I3).toMatchObject({ t: 'b', v: false })
    expect(sheet.N2).toMatchObject({ t: 's', v: '=1+1' })
    expect(sheet.N2.f).toBeUndefined()

    expect(workbook.Sheets.About.A3.v).toBe('Exported: 2026-11-10T12:00:00.000Z (UTC)')
  })

  it('describes the filters in plain language', () => {
    const lines = describeExport({ ...data, filters: { ...data.filters, range: { start: '2026-11-01', end: '2026-11-07' } } }, [])

    expect(lines).toContain('Date range: 2026-11-01 to 2026-11-07 (inclusive)')
    expect(lines).toContain('Habits: none')
  })
})
