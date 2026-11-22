import { describe, expect, it } from 'vitest'

import type { ExternalSample } from '../database/types'

import {
  buildScreenTimeDedupeKey,
  isLocalDate,
  localDayBoundsUtc,
  nextLocalDate,
  validateScreenTimeSample,
} from './screenTime'

describe('local days', () => {
  it('recognises real calendar dates only', () => {
    expect(isLocalDate('2026-11-09')).toBe(true)
    expect(isLocalDate('2028-02-29')).toBe(true)
    expect(isLocalDate('2026-02-29')).toBe(false)
    expect(isLocalDate('2026-13-01')).toBe(false)
    expect(isLocalDate('09/11/2026')).toBe(false)
    expect(isLocalDate(20261109)).toBe(false)
  })

  it('gives the next calendar day across month and year ends', () => {
    expect(nextLocalDate('2026-11-09')).toBe('2026-11-10')
    expect(nextLocalDate('2026-02-28')).toBe('2026-03-01')
    expect(nextLocalDate('2026-12-31')).toBe('2027-01-01')
  })

  it('gives the real start and end of a normal Paris day (UTC+1 in November)', () => {
    expect(localDayBoundsUtc('2026-11-09', 'Europe/Paris')).toEqual({
      startUtc: '2026-11-08T23:00:00.000Z',
      endUtc: '2026-11-09T23:00:00.000Z',
    })
  })

  it('handles daylight-saving days: 23 hours in spring, 25 in autumn (Paris 2026)', () => {
    const spring = localDayBoundsUtc('2026-03-29', 'Europe/Paris')
    expect(spring).toEqual({ startUtc: '2026-03-28T23:00:00.000Z', endUtc: '2026-03-29T22:00:00.000Z' })
    const autumn = localDayBoundsUtc('2026-10-25', 'Europe/Paris')
    expect(autumn).toEqual({ startUtc: '2026-10-24T22:00:00.000Z', endUtc: '2026-10-25T23:00:00.000Z' })
  })

  it('starts the day at 01:00 where clocks jump forward at midnight (Santiago, 6 Sep 2026)', () => {
    // Chile moves from UTC−4 to UTC−3 at 00:00 on the first Sunday of September.
    const bounds = localDayBoundsUtc('2026-09-06', 'America/Santiago')
    expect(bounds.startUtc).toBe('2026-09-06T04:00:00.000Z')
    expect(bounds.endUtc).toBe('2026-09-07T03:00:00.000Z')
  })

  it('rejects an invalid date', () => {
    expect(() => localDayBoundsUtc('2026-02-30', 'Europe/Paris')).toThrow(/Invalid date/)
  })
})

describe('validateScreenTimeSample', () => {
  const valid: Pick<ExternalSample, 'source' | 'dedupeKey' | 'measurementType' | 'value' | 'unit' | 'startUtc' | 'endUtc' | 'timezone' | 'metadata'> = {
    source: 'import',
    dedupeKey: buildScreenTimeDedupeKey('import', '2026-11-09'),
    measurementType: 'screen_time_daily',
    value: 4380,
    unit: 's',
    startUtc: '2026-11-08T23:00:00.000Z',
    endUtc: '2026-11-09T23:00:00.000Z',
    timezone: 'Europe/Paris',
    metadata: { format: 1, localDate: '2026-11-09', apps: [{ name: 'Messages', seconds: 4380, opens: 2 }] },
  }

  it('accepts a valid day and returns its metadata', () => {
    expect(validateScreenTimeSample(valid).localDate).toBe('2026-11-09')
    expect(validateScreenTimeSample({ ...valid, metadata: { ...valid.metadata, apps: null } }).apps).toBeNull()
  })

  it('uses the source and day in the duplicate-detection key', () => {
    expect(buildScreenTimeDedupeKey('import', '2026-11-09')).toBe('screen_time:import:2026-11-09')
  })

  it('accepts a full 25-hour autumn day but not more', () => {
    const autumn = { ...valid, startUtc: '2026-10-24T22:00:00.000Z', endUtc: '2026-10-25T23:00:00.000Z' }
    const fixed = { ...autumn, dedupeKey: buildScreenTimeDedupeKey('import', '2026-10-25'), metadata: { format: 1, localDate: '2026-10-25', apps: null } }
    expect(() => validateScreenTimeSample({ ...fixed, value: 25 * 3600 })).not.toThrow()
    expect(() => validateScreenTimeSample({ ...fixed, value: 25 * 3600 + 1 })).toThrow(/more than the length of the day/)
  })

  it.each([
    ['another kind of sample', { measurementType: 'steps' }, /unknown kind/],
    ['minutes instead of seconds', { unit: 'min' }, /seconds/],
    ['no timezone', { timezone: null }, /timezone/],
    ['no end', { endUtc: null }, /end of its day/],
    ['a 12-hour "day"', { endUtc: '2026-11-09T11:00:00.000Z' }, /24 hours/],
    ['a negative total', { value: -1 }, /invalid screen time/],
    ['a fractional total', { value: 1.5 }, /invalid screen time/],
    ['more than 24 hours', { value: 86_401 }, /invalid screen time/],
    ['a wrong key', { dedupeKey: 'screen_time:import:2026-11-10' }, /duplicate-detection key/],
    ['no metadata', { metadata: null }, /unknown screen-time format/],
    ['an unknown format', { metadata: { format: 2, localDate: '2026-11-09', apps: null } }, /unknown screen-time format/],
    ['an invalid day', { metadata: { format: 1, localDate: '9/11/2026', apps: null } }, /invalid screen-time day/],
    ['apps not a list', { metadata: { format: 1, localDate: '2026-11-09', apps: 'x' } }, /list of apps/],
    ['an app without a name', { metadata: { format: 1, localDate: '2026-11-09', apps: [{ name: '', seconds: 1, opens: null }] } }, /app name/],
    ['an app with negative time', { metadata: { format: 1, localDate: '2026-11-09', apps: [{ name: 'A', seconds: -1, opens: null }] } }, /time for app "A"/],
    ['an app with invalid opens', { metadata: { format: 1, localDate: '2026-11-09', apps: [{ name: 'A', seconds: 1, opens: 'x' }] } }, /opens for app "A"/],
  ])('rejects %s', (_name, change, message) => {
    expect(() => validateScreenTimeSample({ ...valid, ...change } as typeof valid)).toThrow(message)
  })
})
