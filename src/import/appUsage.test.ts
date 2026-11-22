import { describe, expect, it } from 'vitest'

import { findWordDate, parseAppUsageHistory, parseDuration } from './appUsage'
import { appUsageCsv } from './testAppUsage'

describe('parseDuration', () => {
  it('converts H:MM:SS to seconds (hand-calculated)', () => {
    expect(parseDuration('0:00:00')).toBe(0)
    expect(parseDuration('1:02:03')).toBe(3723)
    expect(parseDuration(' 25:00:01 ')).toBe(90_001)
  })

  it('rejects other formats', () => {
    for (const text of ['', '1:02', '1:60:00', '1:00:60', 'abc', '-1:00:00', '1.5:00:00']) {
      expect(parseDuration(text)).toBeNull()
    }
  })
})

describe('findWordDate', () => {
  it('reads English dates in words, month first or day first', () => {
    expect(findWordDate('Usage history, November 9, 2026')).toBe('2026-11-09')
    expect(findWordDate('Usage history, 9 November 2026')).toBe('2026-11-09')
    expect(findWordDate('Created by App Usage (PRO) on Monday, March 30, 2026 at 02:01')).toBe('2026-03-30')
  })

  it('returns null for other languages and impossible dates', () => {
    expect(findWordDate('Historique, 9 novembre 2026')).toBeNull()
    expect(findWordDate('Usage history, February 30, 2026')).toBeNull()
    expect(findWordDate('no date here')).toBeNull()
  })
})

describe('parseAppUsageHistory', () => {
  it('reads the day, its total, every app and the export time', () => {
    expect(parseAppUsageHistory(appUsageCsv())).toEqual({
      localDate: '2026-11-09',
      totalSeconds: 4380,
      apps: [
        { name: 'Messages', seconds: 3723, opens: 12 },
        { name: 'Maps, offline', seconds: 600, opens: 3 },
        { name: 'Browser', seconds: 57, opens: 1 },
      ],
      appsSeconds: 4380,
      createdLocal: '2026-11-10T02:01',
    })
  })

  it('accepts a byte-order mark, CRLF line endings and an unquoted title', () => {
    const text = '\ufeff' + appUsageCsv().replace('"Usage history, November 9, 2026"', 'Usage history, November 9, 2026').replace(/\n/g, '\r\n')
    expect(parseAppUsageHistory(text).localDate).toBe('2026-11-09')
  })

  it('uses the title to tell month/day from day/month', () => {
    // Day/month phone setting: "9/11/26" with the same title.
    expect(parseAppUsageHistory(appUsageCsv({ dateLine: '9/11/26' })).localDate).toBe('2026-11-09')
    // Four-digit year.
    expect(parseAppUsageHistory(appUsageCsv({ dateLine: '11/9/2026' })).localDate).toBe('2026-11-09')
  })

  it('reads a 12-hour export time', () => {
    const created = 'Created by App Usage (PRO) on Tuesday, November 10, 2026 at 2:01 PM'
    expect(parseAppUsageHistory(appUsageCsv({ created })).createdLocal).toBe('2026-11-10T14:01')
    const midnight = 'Created by App Usage (PRO) on Tuesday, November 10, 2026 at 12:05 AM'
    expect(parseAppUsageHistory(appUsageCsv({ created: midnight })).createdLocal).toBe('2026-11-10T00:05')
  })

  it('keeps a file without a creation line (export time unknown)', () => {
    expect(parseAppUsageHistory(appUsageCsv({ created: null })).createdLocal).toBeNull()
  })

  it('accepts a day without any app (total 0)', () => {
    const day = parseAppUsageHistory(appUsageCsv({ apps: [], total: '0:00:00' }))
    expect(day.apps).toEqual([])
    expect(day.totalSeconds).toBe(0)
  })

  it('keeps per-app times that do not add up exactly (the total is the app\'s own)', () => {
    const day = parseAppUsageHistory(appUsageCsv({ total: '1:13:04' }))
    expect(day.totalSeconds).toBe(4384)
    expect(day.appsSeconds).toBe(4380)
  })

  it('rejects files that are not App Usage exports', () => {
    expect(() => parseAppUsageHistory('Date,Value\n2026-11-09,3\n')).toThrow(/not an App Usage "Usage history" file/)
    expect(() => parseAppUsageHistory('')).toThrow(/not an App Usage/)
  })

  it('rejects invalid app lines with the line number', () => {
    expect(() => parseAppUsageHistory(appUsageCsv({ apps: [['Messages', '62 min', '1']] }))).toThrow(/Line 2: the usage time/)
    expect(() => parseAppUsageHistory(appUsageCsv({ apps: [['Messages', '0:01:00', 'many']] }))).toThrow(/Line 2: the access count/)
    expect(() => parseAppUsageHistory(appUsageCsv({ apps: [['', '0:01:00', '1']] }))).toThrow(/Line 2: the app name/)
  })

  it('rejects an incomplete file', () => {
    expect(() => parseAppUsageHistory('App name,Usage time,Access count\nMessages,0:01:00,1\n')).toThrow(/"Date, Usage time" part/)
    expect(() => parseAppUsageHistory(appUsageCsv({ total: 'unknown' }))).toThrow(/total usage time/)
  })

  it('rejects several-day files (not supported yet)', () => {
    expect(() => parseAppUsageHistory(appUsageCsv({ extraDateLines: ['11/10/26,0:30:00'] }))).toThrow(/covers 2 days/)
  })

  it('rejects a file whose day cannot be confirmed by the title', () => {
    expect(() => parseAppUsageHistory(appUsageCsv({ title: null }))).toThrow(/could not be confirmed/)
    expect(() => parseAppUsageHistory(appUsageCsv({ title: 'Historique d\'utilisation, 9 novembre 2026' }))).toThrow(/could not be confirmed/)
  })

  it('rejects a date line that disagrees with the title', () => {
    expect(() => parseAppUsageHistory(appUsageCsv({ dateLine: '11/8/26' }))).toThrow(/name different days/)
    expect(() => parseAppUsageHistory(appUsageCsv({ dateLine: '2026-11-09' }))).toThrow(/name different days/)
  })
})
