import type { Cell, ExportData, ExportTable } from './buildExport'

/**
 * Serialisers for export tables. Pure functions (XLSX loads SheetJS on
 * demand). Every format carries the same metadata: export time, filters,
 * the timezone rule for date/time columns, and units in the headers.
 */

export const EXPORT_FORMAT = 'personal-data-analyst-export'
export const EXPORT_FORMAT_VERSION = 1

export interface ExportMetadata {
  /** Lines describing the export, shown in Markdown, XLSX and JSON. */
  lines: string[]
}

/** Human-readable description of an export's settings. */
export function describeExport(data: ExportData, habitNames: readonly string[] | 'all'): string[] {
  const { filters } = data

  return [
    `Exported: ${data.exportedAt} (UTC)`,
    `Date range: ${filters.range ? `${filters.range.start} to ${filters.range.end} (inclusive)` : 'all dates'}`,
    `Habits: ${habitNames === 'all' ? 'all' : habitNames.length === 0 ? 'none' : habitNames.join(', ')}`,
    `Data: ${data.tables.map((table) => table.title).join('; ')}`,
    'Dates are YYYY-MM-DD and times HH:mm (24-hour), in the timezone given in the "Timezone of date/time" column; UTC instants are included.',
    'Units are given in column headers or in the Unit column. Deleted records are not included.',
    'This is an export for reading and analysis, not a backup: it cannot be restored. Use Settings & Data → Download backup for that.',
  ]
}

// ---------------------------------------------------------------------------
// CSV (RFC 4180)
// ---------------------------------------------------------------------------

/**
 * Text that a spreadsheet could treat as a formula (= + - @, tab, carriage
 * return) is prefixed with an apostrophe to prevent formula injection.
 * Numbers are written as numbers, so negative values are not affected.
 */
function csvCell(value: Cell): string {
  if (value === null) {
    return ''
  }

  let text = typeof value === 'string' ? value : String(value)

  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) {
    text = `'${text}`
  }

  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

/**
 * One table as CSV: comma separator, CRLF line endings, header row, and
 * a UTF-8 byte order mark so Excel reads accents correctly.
 */
export function toCsv(table: ExportTable): string {
  const lines = [
    table.columns.map((column) => csvCell(column.header)).join(','),
    ...table.rows.map((row) => table.columns.map((column) => csvCell(row[column.key] ?? null)).join(',')),
  ]

  return `﻿${lines.join('\r\n')}\r\n`
}

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

function markdownCell(value: Cell): string {
  if (value === null) {
    return ''
  }

  return String(value)
    .replaceAll('\\', '\\\\')
    .replaceAll('|', '\\|')
    .replace(/\r?\n/g, '<br>')
}

export function toMarkdown(data: ExportData, habitNames: readonly string[] | 'all'): string {
  const parts = [
    '# Personal Data Analyst export',
    '',
    ...describeExport(data, habitNames).map((line) => `- ${line}`),
  ]

  for (const table of data.tables) {
    parts.push('', `## ${table.title}`, '')

    if (table.rows.length === 0) {
      parts.push('_No records._')
      continue
    }

    parts.push(
      `| ${table.columns.map((column) => markdownCell(column.header)).join(' | ')} |`,
      `| ${table.columns.map(() => '---').join(' | ')} |`,
      ...table.rows.map(
        (row) => `| ${table.columns.map((column) => markdownCell(row[column.key] ?? null)).join(' | ')} |`,
      ),
    )
  }

  return `${parts.join('\n')}\n`
}

// ---------------------------------------------------------------------------
// JSON
// ---------------------------------------------------------------------------

export function toJson(data: ExportData, habitNames: readonly string[] | 'all'): string {
  return JSON.stringify(
    {
      format: EXPORT_FORMAT,
      formatVersion: EXPORT_FORMAT_VERSION,
      exportedAt: data.exportedAt,
      displayTimezone: data.displayTimezone,
      filters: data.filters,
      notes: describeExport(data, habitNames),
      tables: Object.fromEntries(
        data.tables.map((table) => [
          table.category,
          {
            title: table.title,
            columns: table.columns,
            rows: table.rows,
          },
        ]),
      ),
    },
    null,
    2,
  )
}

// ---------------------------------------------------------------------------
// XLSX (SheetJS, loaded on demand)
// ---------------------------------------------------------------------------

/** Short sheet names (Excel allows at most 31 characters). */
const SHEET_NAMES: Record<ExportTable['category'], string> = {
  entries: 'Habit entries',
  sleepSessions: 'Sleep sessions (recorded)',
  nights: 'Nights and naps (calculated)',
  screenTime: 'Screen time per day',
  screenTimeApps: 'Screen time per app',
  locationVisits: 'Location visits',
  locationMovements: 'Location movements',
}

/**
 * One workbook: an "About" sheet with the export description, then one
 * sheet per table. Numbers and booleans are typed cells; dates and times
 * are text in the documented formats. SheetJS writes text as text, never
 * as a formula.
 */
export async function toXlsx(data: ExportData, habitNames: readonly string[] | 'all'): Promise<ArrayBuffer> {
  const XLSX = await import('xlsx')
  const workbook = XLSX.utils.book_new()

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([['Personal Data Analyst export'], [], ...describeExport(data, habitNames).map((line) => [line])]),
    'About',
  )

  for (const table of data.tables) {
    const rows = [
      table.columns.map((column) => column.header),
      ...table.rows.map((row) => table.columns.map((column) => row[column.key] ?? null)),
    ]

    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), SHEET_NAMES[table.category])
  }

  return XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
}
