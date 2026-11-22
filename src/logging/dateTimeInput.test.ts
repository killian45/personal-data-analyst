import { describe, expect, it } from 'vitest'

import {
  combineDateAndTime,
  formatDateDMY,
  parseDateDMY,
  parseTime24,
  splitLocalDateTime,
} from './dateTimeInput'

describe('parseTime24', () => {
  it('accepts 24-hour times in several notations', () => {
    expect(parseTime24('14:30')).toBe('14:30')
    expect(parseTime24('8:05')).toBe('08:05')
    expect(parseTime24('14h30')).toBe('14:30')
    expect(parseTime24('14H30')).toBe('14:30')
    expect(parseTime24('14.30')).toBe('14:30')
    expect(parseTime24(' 00:00 ')).toBe('00:00')
    expect(parseTime24('23:59')).toBe('23:59')
  })

  it('rejects invalid or 12-hour times', () => {
    for (const text of ['24:00', '7:60', '2:30 PM', '1430', '14:3', '', 'noon', '-1:00']) {
      expect(parseTime24(text)).toBeNull()
    }
  })
})

describe('parseDateDMY', () => {
  it('reads day/month/year with several separators', () => {
    expect(parseDateDMY('09/11/2026')).toBe('2026-11-09')
    expect(parseDateDMY('9/11/2026')).toBe('2026-11-09')
    expect(parseDateDMY('09.11.2026')).toBe('2026-11-09')
    expect(parseDateDMY('09-11-2026')).toBe('2026-11-09')
    expect(parseDateDMY(' 1/2/2026 ')).toBe('2026-02-01')
  })

  it('reads the day first, never the month first', () => {
    // 03/04 is 3 April, not 4 March.
    expect(parseDateDMY('03/04/2026')).toBe('2026-04-03')
    // 13/01 is valid (13 January); 01/13 is not (no 13th month).
    expect(parseDateDMY('13/01/2026')).toBe('2026-01-13')
    expect(parseDateDMY('01/13/2026')).toBeNull()
  })

  it('accepts 29 February only in leap years', () => {
    expect(parseDateDMY('29/02/2028')).toBe('2028-02-29')
    expect(parseDateDMY('29/02/2026')).toBeNull()
  })

  it('rejects impossible or incomplete dates', () => {
    for (const text of ['31/02/2026', '31/04/2026', '00/11/2026', '11/2026', '2026-11-09', '09/11/26', '']) {
      expect(parseDateDMY(text)).toBeNull()
    }
  })
})

describe('formatDateDMY', () => {
  it('formats an internal date as dd/mm/yyyy', () => {
    expect(formatDateDMY('2026-11-09')).toBe('09/11/2026')
    expect(formatDateDMY('')).toBe('')
  })
})

describe('combineDateAndTime', () => {
  it('combines a typed date and time into a local date-time', () => {
    expect(combineDateAndTime('09/11/2026', '8h05')).toBe('2026-11-09T08:05')
  })

  it('returns null when the date or time is missing or invalid', () => {
    expect(combineDateAndTime('', '08:00')).toBeNull()
    expect(combineDateAndTime('2026-11-09', '08:00')).toBeNull()
    expect(combineDateAndTime('31/02/2026', '08:00')).toBeNull()
    expect(combineDateAndTime('09/11/2026', '')).toBeNull()
    expect(combineDateAndTime('09/11/2026', '25:00')).toBeNull()
  })
})

describe('splitLocalDateTime', () => {
  it('splits into dd/mm/yyyy and HH:mm, dropping seconds', () => {
    expect(splitLocalDateTime('2026-11-09T08:05:30')).toEqual({ date: '09/11/2026', time: '08:05' })
  })
})
