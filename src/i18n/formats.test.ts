import { describe, expect, it } from 'vitest'

import { fullPeriodLabel, rangeLabel, shortPeriodLabel } from '../components/dashboard/periodLabels'
import { formatInTimezone } from '../time/time'

import { formatNumber, numberLocale } from './formats'

/**
 * Sharing plan S2j: English output must stay exactly as before (British
 * conventions, fixed dd/mm/yyyy and 24-hour patterns).
 */
describe('formats in English', () => {
  it('uses British number separators', () => {
    expect(numberLocale()).toBe('en-GB')
    expect(formatNumber(1234.567)).toBe('1,234.57')
    expect(formatNumber(2, { minimumFractionDigits: 2, maximumFractionDigits: 2 })).toBe('2.00')
    expect(formatNumber(1999.6, { maximumFractionDigits: 0 })).toBe('2,000')
  })

  it('keeps month and weekday names and fixed numeric patterns', () => {
    expect(formatInTimezone('2026-11-09T08:00:00.000Z', 'Europe/Paris', 'EEE d MMM yyyy')).toBe('Mon 9 Nov 2026')
    expect(formatInTimezone('2026-09-09T21:30:00.000Z', 'Europe/Paris', 'dd/MM/yyyy HH:mm')).toBe('09/09/2026 23:30')
  })

  it('keeps the dashboard period labels', () => {
    expect(shortPeriodLabel('2026-09-09', 'day')).toBe('9 Sep')
    expect(shortPeriodLabel('2026-09-01', 'month')).toBe('Sep 2026')
    expect(fullPeriodLabel('2026-09-07', 'week')).toBe('Week of 7 Sep 2026')
    expect(fullPeriodLabel('2026-09-07', 'day')).toBe('7 Sep 2026')
    expect(rangeLabel('2026-10-12', '2026-11-10')).toBe('12 Oct – 10 Nov 2026')
    expect(rangeLabel('2025-12-28', '2026-01-03')).toBe('28 Dec 2025 – 3 Jan 2026')
  })
})
