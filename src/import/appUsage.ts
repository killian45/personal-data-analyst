import { messages } from '../i18n'
import { isLocalDate } from '../screenTime/screenTime'
import type { ScreenTimeApp } from '../screenTime/screenTime'

import { parseCsv } from './csv'

/**
 * Reader for the "Usage history" CSV exported by the Android app
 * "App Usage" (file names like AUM_V4_Usage_2026-11-09_02-01-22.csv).
 * Pure: no database, no React.
 *
 * Layout observed in real exports (structure only, 2026-11-11):
 *
 *   App name,Usage time,Access count      ← header
 *   <app>,H:MM:SS,<opens>                 ← one row per app
 *   (empty line)
 *   Date,Usage time
 *   M/D/YY,H:MM:SS                        ← the day and its total
 *   (empty line)
 *   Usage history, November 9, 2026       ← title (English)
 *   Created by App Usage (PRO) on Monday, November 10, 2026 at 02:01
 *
 * Decisions:
 * - The date line's day/month order depends on the phone's language, so
 *   it is only accepted when it agrees with the title's date (written in
 *   words). A file whose title cannot be read is rejected, never guessed.
 * - Only files covering exactly one day are accepted (the per-app list
 *   then belongs to that day). Several-day exports have not been seen yet.
 * - The day's total is the app's own figure; the per-app rows are kept as
 *   they are (their sum may differ by a few seconds of rounding).
 * - The export time ("Created … at") is the phone's local time, used to
 *   recognise a day that was exported before it ended.
 */

export const APP_USAGE_SOURCE_APP = 'App Usage'
export const APP_USAGE_FILE_FORMAT = 'app_usage_usage_history_csv'

export interface AppUsageDay {
  /** The day the file covers, "YYYY-MM-DD" (phone's local calendar). */
  localDate: string
  totalSeconds: number
  apps: ScreenTimeApp[]
  /** Sum of the per-app times, for information. */
  appsSeconds: number
  /** When the file was created, phone local time "YYYY-MM-DDTHH:mm", if stated. */
  createdLocal: string | null
}

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
]

const HEADER = ['app name', 'usage time', 'access count']

function fail(message: string): never {
  throw new Error(message)
}

function isEmptyRow(row: string[]): boolean {
  return row.every((cell) => cell.trim() === '')
}

/** "H:MM:SS" (hours may exceed 24) → seconds, or null. */
export function parseDuration(text: string): number | null {
  const match = /^(\d{1,4}):([0-5]\d):([0-5]\d)$/.exec(text.trim())
  return match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : null
}

function toLocalDate(year: number, month: number, day: number): string | null {
  const text = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  return isLocalDate(text) ? text : null
}

/**
 * Finds an English date written in words: "November 9, 2026" or
 * "9 November 2026". Returns "YYYY-MM-DD" or null.
 */
export function findWordDate(text: string): string | null {
  const lower = text.toLowerCase()
  const monthFirst = /\b([a-z]+)\s+(\d{1,2}),?\s+(\d{4})\b/.exec(lower)
  if (monthFirst && MONTHS.includes(monthFirst[1])) {
    return toLocalDate(Number(monthFirst[3]), MONTHS.indexOf(monthFirst[1]) + 1, Number(monthFirst[2]))
  }
  const dayFirst = /\b(\d{1,2})\s+([a-z]+),?\s+(\d{4})\b/.exec(lower)
  if (dayFirst && MONTHS.includes(dayFirst[2])) {
    return toLocalDate(Number(dayFirst[3]), MONTHS.indexOf(dayFirst[2]) + 1, Number(dayFirst[1]))
  }
  return null
}

/** Both readings of a numeric date "A/B/YY(YY)": month/day and day/month. */
function numericDateCandidates(text: string): string[] {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(text.trim())
  if (!match) return []
  const [a, b] = [Number(match[1]), Number(match[2])]
  const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3])
  return [toLocalDate(year, a, b), toLocalDate(year, b, a)].filter((date): date is string => date !== null)
}

/** "… at 02:01" / "… at 2:01 AM" → "HH:mm", or null. */
function findTime(text: string): string | null {
  const match = /\bat\s+(\d{1,2}):(\d{2})(?:\s*([ap])\.?m\.?)?/i.exec(text)
  if (!match) return null
  let hour = Number(match[1])
  const minute = Number(match[2])
  const half = match[3]?.toLowerCase()
  if (half) {
    if (hour < 1 || hour > 12) return null
    hour = (hour % 12) + (half === 'p' ? 12 : 0)
  }
  if (hour > 23 || minute > 59) return null
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

/**
 * Reads one App Usage "Usage history" CSV file. Throws an Error with a
 * plain-language reason if the file cannot be used as a whole.
 */
export function parseAppUsageHistory(text: string): AppUsageDay {
  const rows = parseCsv(text)
  const header = rows[0]?.map((cell) => cell.trim().toLowerCase())

  if (!header || header.length < 3 || HEADER.some((name, index) => header[index] !== name)) {
    fail(messages().importText.appUsage.notFile)
  }

  // 1. One row per app, until the first empty line.
  const apps: ScreenTimeApp[] = []
  let index = 1
  for (; index < rows.length && !isEmptyRow(rows[index]); index += 1) {
    const row = rows[index]
    const line = index + 1
    const name = (row[0] ?? '').trim()
    const seconds = parseDuration(row[1] ?? '')
    const opensText = (row[2] ?? '').trim()

    if (row.length < 3) fail(messages().importText.appUsage.appLine(line))
    if (name === '') fail(messages().importText.appUsage.appName(line))
    if (seconds === null) fail(messages().importText.appUsage.usageTime(line))
    if (!/^\d{1,7}$/.test(opensText)) fail(messages().importText.appUsage.accessCount(line))

    apps.push({ name, seconds, opens: Number(opensText) })
  }

  // 2. The "Date, Usage time" section.
  const dateHeader = rows.findIndex(
    (row, position) => position > index && row[0]?.trim().toLowerCase() === 'date' && row[1]?.trim().toLowerCase() === 'usage time',
  )
  if (dateHeader === -1) fail('The "Date, Usage time" part of the file is missing (the file may be incomplete).')

  const dateRows: string[][] = []
  for (let position = dateHeader + 1; position < rows.length && !isEmptyRow(rows[position]); position += 1) {
    dateRows.push(rows[position])
  }
  if (dateRows.length === 0) fail(messages().importText.appUsage.noDay)
  if (dateRows.length > 1) {
    fail(messages().importText.appUsage.severalDays(dateRows.length))
  }

  const [dateText, totalText] = dateRows[0]
  const totalSeconds = parseDuration(totalText ?? '')
  if (totalSeconds === null) fail(messages().importText.appUsage.total)

  // 3. Title and creation line (after the date section).
  const trailing = rows.slice(dateHeader + 1 + dateRows.length).map((row) => row.join(',').trim()).filter(Boolean)
  const title = trailing.find((line) => /^usage history\b/i.test(line))
  const created = trailing.find((line) => /^created by\b/i.test(line))

  const titleDate = title ? findWordDate(title) : null
  if (titleDate === null) {
    fail(messages().importText.appUsage.title)
  }
  if (!numericDateCandidates(dateText ?? '').includes(titleDate)) {
    fail(messages().importText.appUsage.dateMismatch)
  }

  const createdDate = created ? findWordDate(created) : null
  const createdTime = created ? findTime(created) : null

  return {
    localDate: titleDate,
    totalSeconds,
    apps,
    appsSeconds: apps.reduce((sum, app) => sum + app.seconds, 0),
    createdLocal: createdDate && createdTime ? `${createdDate}T${createdTime}` : null,
  }
}
