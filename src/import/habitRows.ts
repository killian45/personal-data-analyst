import { messages } from '../i18n'
import { MAX_COMMENT_LENGTH, MAX_TEXT_LENGTH } from '../database/validation'
import type { Entry, EntryValue, Habit } from '../database/types'
import { addDays } from '../stats/subjects'
import { localDateTimeToUtc } from '../time/time'

import { parseCsv } from './csv'

/**
 * Habit entries from a spreadsheet (CSV file or cells pasted from a
 * spreadsheet). Pure: the user maps columns, every row is checked and
 * converted, and nothing is guessed silently. See docs/HABIT_IMPORT.md.
 *
 * Conventions (documented):
 * - Dates are read in the order the user chooses (day/month/year by
 *   default); 2-digit years mean 20xx.
 * - Local times are converted to UTC in the chosen timezone with the
 *   clock-change rules of that date: a time that does not exist (clocks
 *   forward) is a problem; a time that exists twice (clocks back) takes
 *   the first one and is flagged.
 * - A date without a time: stopwatch rows need times (problem); other
 *   habits get 12:00 local time, so the entry stays on that day.
 * - Several categories in one cell ("Love, Excitement") give one entry
 *   each, at the same time (a category entry holds one category).
 * - Rows whose mapped cells are all empty are counted as empty (for
 *   example the rows of another habit in the same sheet), never imported.
 * - Duplicates (same habit, same time(s), same value — already in the app
 *   or earlier in the file) are counted and skipped.
 */

export type DateOrder = 'dmy' | 'mdy' | 'ymd'

/** Columns giving a moment: a date column and, if separate, a time column. */
export interface WhenColumns {
  date: number
  /** null: the date column holds the time too (or there is no time). */
  time: number | null
}

export type ImportMapping =
  | { type: 'stopwatch'; start: WhenColumns; end: WhenColumns; comment: number | null }
  | { type: 'number' | 'checkbox' | 'label' | 'text'; value: number; when: WhenColumns; comment: number | null }

export interface ImportOptions {
  order: DateOrder
  timezone: string
  firstRowIsHeader: boolean
  /** Stopwatch: a stop that is not after the start ended the next day. */
  nextDayIfEarlier: boolean
}

export interface ImportItem {
  /** Spreadsheet row number (1 = first line of the file). */
  row: number
  /** Several categories in one cell: 1, 2, 3… for each of them; null otherwise. */
  part: number | null
  value: EntryValue | null
  occurredStart: string
  occurredEnd: string | null
  comment: string | null
  /** The local times as read, for the preview. */
  localStart: string
  localEnd: string | null
  /** A local time that happens twice (clocks went back); the first was used. */
  ambiguous: boolean
}

export type RowResult =
  | { kind: 'ready'; item: ImportItem }
  | { kind: 'duplicate'; item: ImportItem; within: 'app' | 'file' }
  | { kind: 'empty'; row: number }
  | { kind: 'problem'; row: number; message: string }

// ---------------------------------------------------------------------------
// Reading the table

/** The separator used by the text: tab (pasted cells), semicolon or comma, whichever the first line uses most. */
export function detectDelimiter(text: string): ',' | ';' | '\t' {
  const first = text.replace(/^﻿/, '').split(/\r?\n/, 1)[0] ?? ''
  const count = (char: string) => first.split(char).length - 1
  const tabs = count('\t')
  const semicolons = count(';')
  const commas = count(',')
  if (tabs > 0 && tabs >= semicolons && tabs >= commas) return '\t'
  return semicolons > commas ? ';' : ','
}

/** Rows of the table, with fully empty lines at the end removed. */
export function readTable(text: string, delimiter = detectDelimiter(text)): string[][] {
  const rows = parseCsv(text, delimiter)
  while (rows.length > 0 && rows[rows.length - 1].every((cell) => cell.trim() === '')) rows.pop()
  return rows
}

/** Column names: the header's texts, or "Column A", "Column B"… */
export function columnNames(table: readonly string[][], firstRowIsHeader: boolean): string[] {
  const width = Math.max(0, ...table.map((row) => row.length))
  const letter = (index: number): string => (index < 26 ? String.fromCharCode(65 + index) : letter(Math.floor(index / 26) - 1) + letter(index % 26))
  return Array.from({ length: width }, (_, index) => {
    const header = firstRowIsHeader ? (table[0]?.[index] ?? '').trim() : ''
    return header ? `${header} (column ${letter(index)})` : `Column ${letter(index)}`
  })
}

// ---------------------------------------------------------------------------
// Cells

const DATE = /^(\d{1,4})[/.-](\d{1,2})[/.-](\d{1,4})$/
const TIME = /^(\d{1,2})(?:[:hH.](\d{2}))?(?::(\d{2}))?\s*([aApP][mM])?$/

function two(value: number): string {
  return String(value).padStart(2, '0')
}

/** "13/11/2026" → "2026-11-13" (null if not a real date in that order). */
export function parseDate(text: string, order: DateOrder): string | null {
  const match = DATE.exec(text.trim())
  if (!match) return null
  const [a, b, c] = match.slice(1, 4)
  let [year, month, day] = order === 'ymd' ? [a, b, c] : order === 'dmy' ? [c, b, a] : [c, a, b]
  if (year.length === 2) year = `20${year}`
  if (year.length !== 4) return null
  const [y, m, d] = [Number(year), Number(month), Number(day)]
  const check = new Date(Date.UTC(y, m - 1, d))
  if (y < 1900 || y > 2100 || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null
  return `${year}-${two(m)}-${two(d)}`
}

/** "22:15", "9:05 pm", "9 pm", "22h15", "22.15", "22:15:30" → "22:15:00" (null if not a time). */
export function parseTime(text: string): string | null {
  const value = text.trim()
  const match = TIME.exec(value)
  if (!match) return null
  const [, h, min, sec, meridiem] = match
  if (min === undefined && !meridiem) return null
  let hours = Number(h)
  if (meridiem) {
    if (hours < 1 || hours > 12) return null
    hours = (hours % 12) + (meridiem.toLowerCase() === 'pm' ? 12 : 0)
  }
  const minutes = Number(min ?? 0)
  const seconds = Number(sec ?? 0)
  if (hours > 23 || minutes > 59 || seconds > 59) return null
  return `${two(hours)}:${two(minutes)}:${two(seconds)}`
}

/** A date cell that may also hold the time ("13/11/2026 22:15", "2026-11-13T22:15"). */
function splitDateTime(text: string): [string, string | null] {
  const value = text.trim()
  const match = /^(\S+?)(?:[T\s]+(.+))?$/.exec(value)
  return match ? [match[1], match[2]?.trim() ?? null] : [value, null]
}

/**
 * "2,5", "2.5", "50 mg", "0.125" → number; null if not a plain number;
 * "ambiguous" for "1,000" or "2.500" (one thousand or one? 2500 or 2.5?),
 * which the user must write unambiguously (1000, 1.0, 2.5).
 */
export function parseNumber(text: string): number | null | 'ambiguous' {
  const match = /^\s*([-+]?)(\d+)(?:[.,](\d+))?\s*[a-zA-Zµ%/]*\s*$/.exec(text)
  if (!match) return null
  const [, sign, whole, decimals] = match
  if (decimals !== undefined && decimals.length === 3 && whole.length <= 3 && Number(whole) !== 0) return 'ambiguous'
  const value = Number(`${sign}${whole}${decimals === undefined ? '' : `.${decimals}`}`)
  return Number.isFinite(value) ? value : null
}

const YES = new Set(['yes', 'y', 'true', '1', 'x', '✓', '✔', 'done', 'oui', 'vrai'])
const NO = new Set(['no', 'n', 'false', '0', 'non', 'faux'])

export function parseCheckbox(text: string): boolean | null {
  const value = text.trim().toLowerCase()
  return YES.has(value) ? true : NO.has(value) ? false : null
}

// ---------------------------------------------------------------------------
// Rows

type Moment = { ok: true; local: string; hasTime: boolean } | { ok: false; message: string }

function readMoment(row: readonly string[], columns: WhenColumns, order: DateOrder, column: 'start' | 'stop' | 'date'): Moment {
  const what = messages().importText.habitRows.columns[column]
  const dateCell = (row[columns.date] ?? '').trim()
  if (dateCell === '') return { ok: false, message: messages().importText.habitRows.dateEmpty(what) }
  const [datePart, timeInDate] = columns.time === null ? splitDateTime(dateCell) : [dateCell, null]
  const date = parseDate(datePart, order)
  if (!date) return { ok: false, message: messages().importText.habitRows.notDate(what, dateCell, order) }
  const timeCell = columns.time === null ? timeInDate : (row[columns.time] ?? '').trim()
  if (timeCell === null || timeCell === '') return { ok: true, local: `${date}T12:00:00`, hasTime: false }
  const time = parseTime(timeCell)
  if (!time) return { ok: false, message: messages().importText.habitRows.notTime(what, timeCell) }
  return { ok: true, local: `${date}T${time}`, hasTime: true }
}

function toUtc(local: string, timezone: string): { utc: string; ambiguous: boolean } | { message: string } {
  try {
    return localDateTimeToUtc(local, timezone)
  } catch (error) {
    return { message: error instanceof Error ? error.message : messages().importText.habitRows.invalidDateTime }
  }
}

function cellsOf(mapping: ImportMapping): number[] {
  const when = (columns: WhenColumns) => (columns.time === null ? [columns.date] : [columns.date, columns.time])
  const cells = mapping.type === 'stopwatch' ? [...when(mapping.start), ...when(mapping.end)] : [mapping.value, ...when(mapping.when)]
  return mapping.comment === null ? cells : [...cells, mapping.comment]
}

/**
 * The value(s) of a cell. Categories: the whole cell if it is one of the
 * habit's categories; otherwise several categories separated by commas or
 * semicolons ("Love, Excitement, Pride"), each becoming its own entry.
 */
function readValues(habit: Habit, text: string): { ok: true; values: EntryValue[] } | { ok: false; message: string } {
  if (habit.type === 'label') {
    const cell = text.trim()
    const find = (part: string) => habit.labelOptions.find((label) => label.toLowerCase() === part.toLowerCase())
    const whole = find(cell)
    if (whole !== undefined) return { ok: true, values: [whole] }
    const parts = cell.split(/[,;]/).map((part) => part.trim()).filter((part) => part !== '')
    const unknown = parts.filter((part) => find(part) === undefined)
    if (parts.length === 0 || unknown.length > 0) {
      return { ok: false, message: messages().importText.habitRows.unknownCategories(unknown.length > 0 ? unknown : [cell], habit.labelOptions.join(', ')) }
    }
    return { ok: true, values: [...new Set(parts.map((part) => find(part) as string))] }
  }
  const single = readValue(habit, text)
  return single.ok ? { ok: true, values: [single.value] } : single
}

function readValue(habit: Habit, text: string): { ok: true; value: EntryValue } | { ok: false; message: string } {
  const cell = text.trim()
  switch (habit.type) {
    case 'number': {
      const value = parseNumber(cell)
      if (value === 'ambiguous') return { ok: false, message: messages().importText.habitRows.ambiguous(cell) }
      return value === null ? { ok: false, message: messages().importText.habitRows.notNumber(cell) } : { ok: true, value }
    }
    case 'checkbox': {
      const value = parseCheckbox(cell)
      return value === null ? { ok: false, message: messages().importText.habitRows.notYesNo(cell) } : { ok: true, value }
    }
    case 'label': {
      const option = habit.labelOptions.find((label) => label.toLowerCase() === cell.toLowerCase())
      return option === undefined
        ? { ok: false, message: messages().importText.habitRows.unknownCategories([cell], habit.labelOptions.join(', ')) }
        : { ok: true, value: option }
    }
    case 'text':
      return cell.length > MAX_TEXT_LENGTH ? { ok: false, message: messages().importText.habitRows.textTooLong(MAX_TEXT_LENGTH) } : { ok: true, value: cell }
    case 'stopwatch':
      return { ok: false, message: messages().importText.habitRows.stopwatchColumns }
  }
}

/** Checks and converts every row (header excluded). */
export function prepareRows(table: readonly string[][], habit: Habit, mapping: ImportMapping, options: ImportOptions): RowResult[] {
  const first = options.firstRowIsHeader ? 1 : 0
  const cells = cellsOf(mapping)
  const results: RowResult[] = []

  for (let index = first; index < table.length; index += 1) {
    const row = table[index]
    const rowNumber = index + 1
    if (cells.every((cell) => (row[cell] ?? '').trim() === '')) {
      results.push({ kind: 'empty', row: rowNumber })
      continue
    }
    const problem = (message: string) => results.push({ kind: 'problem', row: rowNumber, message })

    const comment = mapping.comment === null ? '' : (row[mapping.comment] ?? '').trim()
    if (comment.length > MAX_COMMENT_LENGTH) {
      problem(messages().importText.habitRows.commentTooLong(MAX_COMMENT_LENGTH))
      continue
    }

    if (mapping.type === 'stopwatch') {
      const start = readMoment(row, mapping.start, options.order, 'start')
      if (!start.ok) { problem(start.message); continue }
      const end = readMoment(row, mapping.end, options.order, 'stop')
      if (!end.ok) { problem(end.message); continue }
      if (!start.hasTime || !end.hasTime) { problem(messages().importText.habitRows.timeNeeded(messages().importText.habitRows.columns[start.hasTime ? 'stop' : 'start'])); continue }
      let localEnd = end.local
      if (localEnd <= start.local && options.nextDayIfEarlier) localEnd = `${addDays(localEnd.slice(0, 10), 1)}${localEnd.slice(10)}`
      const startUtc = toUtc(start.local, options.timezone)
      if ('message' in startUtc) { problem(messages().importText.habitRows.prefixed(messages().importText.habitRows.columns.start, startUtc.message)); continue }
      const endUtc = toUtc(localEnd, options.timezone)
      if ('message' in endUtc) { problem(messages().importText.habitRows.prefixed(messages().importText.habitRows.columns.stop, endUtc.message)); continue }
      if (endUtc.utc <= startUtc.utc) { problem(messages().importText.habitRows.stopNotAfter); continue }
      results.push({
        kind: 'ready',
        item: { row: rowNumber, part: null, value: null, occurredStart: startUtc.utc, occurredEnd: endUtc.utc, comment: comment || null, localStart: start.local, localEnd, ambiguous: startUtc.ambiguous || endUtc.ambiguous },
      })
      continue
    }

    const valueCell = (row[mapping.value] ?? '').trim()
    if (valueCell === '') { problem(messages().importText.habitRows.valueEmpty); continue }
    const value = readValues(habit, valueCell)
    if (!value.ok) { problem(value.message); continue }
    const when = readMoment(row, mapping.when, options.order, 'date')
    if (!when.ok) { problem(when.message); continue }
    const utc = toUtc(when.local, options.timezone)
    if ('message' in utc) { problem(messages().importText.habitRows.prefixed(messages().importText.habitRows.columns.date, utc.message)); continue }
    const several = value.values.length > 1
    value.values.forEach((entryValue, index) => results.push({
      kind: 'ready',
      item: { row: rowNumber, part: several ? index + 1 : null, value: entryValue, occurredStart: utc.utc, occurredEnd: null, comment: comment || null, localStart: when.local, localEnd: null, ambiguous: utc.ambiguous },
    }))
  }
  return results
}

// ---------------------------------------------------------------------------
// Duplicates

/** Same moment(s) and same value = the same entry. */
export function entryKey(entry: Pick<Entry, 'occurredStart' | 'occurredEnd' | 'habitType'> & { value: EntryValue | null }): string {
  const value = entry.habitType === 'stopwatch' ? '' : JSON.stringify(entry.value)
  return `${entry.occurredStart}|${entry.occurredEnd ?? ''}|${value}`
}

/** Marks rows already in the app (existing entries of the habit) or earlier in the file. */
export function markDuplicates(results: readonly RowResult[], habit: Pick<Habit, 'type'>, existing: readonly Entry[]): RowResult[] {
  const inApp = new Set(existing.filter((entry) => entry.deletedAt === null).map(entryKey))
  const seen = new Set<string>()
  return results.map((result) => {
    if (result.kind !== 'ready') return result
    const key = entryKey({ ...result.item, habitType: habit.type })
    if (inApp.has(key)) return { kind: 'duplicate', item: result.item, within: 'app' }
    if (seen.has(key)) return { kind: 'duplicate', item: result.item, within: 'file' }
    seen.add(key)
    return result
  })
}

export function summarize(results: readonly RowResult[]): { ready: number; duplicates: number; empty: number; problems: number; ambiguous: number } {
  const count = (kind: RowResult['kind']) => results.filter((result) => result.kind === kind).length
  return {
    ready: count('ready'),
    duplicates: count('duplicate'),
    empty: count('empty'),
    problems: count('problem'),
    ambiguous: results.filter((result) => result.kind === 'ready' && result.item.ambiguous).length,
  }
}
