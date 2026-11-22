import { messages } from '../i18n'
/**
 * Helpers for the date (dd/mm/yyyy) and 24-hour time fields.
 *
 * The browser's own date and time fields choose their format (mm/dd/yyyy,
 * AM/PM...) from the browser language, which the app cannot control. The
 * app therefore uses its own text fields: dates are typed as dd/mm/yyyy
 * and times on the 24-hour clock. Internally dates are "YYYY-MM-DD".
 */

const TIME_24H = /^(\d{1,2})[:hH.](\d{2})$/
const DATE_DMY = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * Reads a date typed as day/month/year and returns "YYYY-MM-DD",
 * or null if it is not a real calendar date.
 *
 * Accepted: "09/11/2026", "9/11/2026", "09.11.2026", "09-11-2026".
 * Rejected: "31/02/2026", "11/2026", "2026-11-09", "".
 */
export function parseDateDMY(text: string): string | null {
  const match = DATE_DMY.exec(text.trim())

  if (!match) {
    return null
  }

  const day = Number(match[1])
  const month = Number(match[2])
  const year = Number(match[3])
  const check = new Date(Date.UTC(year, month - 1, day))

  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null
  }

  return `${match[3]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** Formats "YYYY-MM-DD" as "dd/mm/yyyy" ("" stays ""). */
export function formatDateDMY(isoDate: string): string {
  const match = ISO_DATE.exec(isoDate)

  return match ? `${match[3]}/${match[2]}/${match[1]}` : ''
}

/**
 * Reads a 24-hour time typed by the user and returns "HH:mm",
 * or null if it is not a valid time.
 *
 * Accepted: "14:30", "8:05", "14h30", "14H30", "14.30".
 * Rejected: "24:00", "7:60", "2:30 PM", "1430", "".
 */
export function parseTime24(text: string): string | null {
  const match = TIME_24H.exec(text.trim())

  if (!match) {
    return null
  }

  const hours = Number(match[1])
  const minutes = Number(match[2])

  if (hours > 23 || minutes > 59) {
    return null
  }

  return `${String(hours).padStart(2, '0')}:${match[2]}`
}

/**
 * Combines a typed date (dd/mm/yyyy) and a typed 24-hour time into a
 * local date-time ("YYYY-MM-DDTHH:mm"), or null if either is invalid.
 */
export function combineDateAndTime(
  dateText: string,
  timeText: string,
): string | null {
  const date = parseDateDMY(dateText)
  const time = parseTime24(timeText)

  if (date === null || time === null) {
    return null
  }

  return `${date}T${time}`
}

/**
 * Splits a local date-time ("YYYY-MM-DDTHH:mm[:ss]") into the texts shown
 * in the date (dd/mm/yyyy) and time (HH:mm) fields.
 */
export function splitLocalDateTime(localDateTime: string): {
  date: string
  time: string
} {
  return {
    date: formatDateDMY(localDateTime.slice(0, 10)),
    time: localDateTime.slice(11, 16),
  }
}

/** The message for a date or time that cannot be read (current language). */
export function invalidDateTimeMessage(): string {
  return messages().inputText.invalidDateTime
}
