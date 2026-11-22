import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  elapsedMilliseconds,
  FALLBACK_TIMEZONE,
  formatInTimezone,
  getDeviceTimezone,
  getUtcOffsetMinutes,
  isValidTimezone,
  localDateTimeToUtc,
  utcToLocalDateTime,
} from './time'

const HOUR_MS = 3_600_000

// Expected values below are hand-calculated from the timezone rules:
// - Europe/Paris: UTC+1 in winter, UTC+2 in summer. Clocks go forward
//   02:00 → 03:00 on 2026-03-29 and back 03:00 → 02:00 on 2026-10-25.
// - America/New_York: UTC−5 / UTC−4. Forward on 2026-03-08 at 02:00,
//   back on 2026-11-01 at 02:00.
// - Asia/Tokyo: UTC+9, no daylight saving.
// - Australia/Lord_Howe: UTC+10:30 / UTC+11, a 30-minute change.
//   Forward 02:00 → 02:30 on 2026-10-04.

describe('test environment', () => {
  it('runs in America/New_York so hidden reliance on the machine timezone is caught', () => {
    // 2026-01-15 is winter in New York: UTC−5 = 300 minutes behind.
    expect(new Date('2026-01-15T12:00:00Z').getTimezoneOffset()).toBe(300)
  })
})

describe('isValidTimezone', () => {
  it('accepts IANA names and UTC', () => {
    expect(isValidTimezone('Europe/Paris')).toBe(true)
    expect(isValidTimezone('UTC')).toBe(true)
  })

  it('rejects unknown, empty and non-text values', () => {
    expect(isValidTimezone('Mars/Olympus')).toBe(false)
    expect(isValidTimezone('')).toBe(false)
    expect(isValidTimezone(null)).toBe(false)
  })
})

describe('getDeviceTimezone', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  function mockDeviceTimezone(timeZone: string | undefined) {
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
      timeZone,
    } as Intl.ResolvedDateTimeFormatOptions)
  }

  it('returns the device timezone', () => {
    mockDeviceTimezone('Asia/Tokyo')
    expect(getDeviceTimezone()).toBe('Asia/Tokyo')
  })

  it('falls back to Europe/Paris when the timezone is missing', () => {
    mockDeviceTimezone(undefined)
    expect(getDeviceTimezone()).toBe(FALLBACK_TIMEZONE)
    expect(FALLBACK_TIMEZONE).toBe('Europe/Paris')
  })

  it('falls back to Europe/Paris when the timezone is unknown or invalid', () => {
    mockDeviceTimezone('Etc/Unknown')
    expect(getDeviceTimezone()).toBe('Europe/Paris')

    mockDeviceTimezone('Mars/Olympus')
    expect(getDeviceTimezone()).toBe('Europe/Paris')
  })

  it('falls back to Europe/Paris when reading the timezone fails', () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(() => {
      throw new Error('Unavailable')
    })
    expect(getDeviceTimezone()).toBe('Europe/Paris')
  })
})

describe('localDateTimeToUtc', () => {
  it('converts winter and summer times in Paris', () => {
    // 14:30 at UTC+1 = 13:30 UTC; 14:30 at UTC+2 = 12:30 UTC
    expect(localDateTimeToUtc('2026-11-09T14:30', 'Europe/Paris')).toEqual({
      utc: '2026-11-09T13:30:00.000Z',
      ambiguous: false,
    })
    expect(localDateTimeToUtc('2026-07-01T14:30', 'Europe/Paris').utc).toBe(
      '2026-07-01T12:30:00.000Z',
    )
  })

  it('accepts seconds', () => {
    expect(localDateTimeToUtc('2026-11-09T14:30:45', 'Europe/Paris').utc).toBe(
      '2026-11-09T13:30:45.000Z',
    )
  })

  it('converts the same wall-clock time differently in different timezones', () => {
    // 08:00 Tokyo (UTC+9) = 23:00 UTC the previous day
    expect(localDateTimeToUtc('2026-11-09T08:00', 'Asia/Tokyo').utc).toBe(
      '2026-11-08T23:00:00.000Z',
    )
    // 08:00 New York in November after the change (UTC−5) = 13:00 UTC
    expect(localDateTimeToUtc('2026-11-09T08:00', 'America/New_York').utc).toBe(
      '2026-11-09T13:00:00.000Z',
    )
  })

  describe('clocks moving forward (non-existent times)', () => {
    it('rejects 02:30 in Paris on 2026-03-29 instead of moving it', () => {
      expect(() => localDateTimeToUtc('2026-03-29T02:30', 'Europe/Paris')).toThrow(
        'This time does not exist in Europe/Paris because the clocks moved forward',
      )
    })

    it('accepts the minutes just before and just after the gap', () => {
      // 01:59 at UTC+1 = 00:59 UTC; 03:00 at UTC+2 = 01:00 UTC
      expect(localDateTimeToUtc('2026-03-29T01:59', 'Europe/Paris').utc).toBe(
        '2026-03-29T00:59:00.000Z',
      )
      expect(localDateTimeToUtc('2026-03-29T03:00', 'Europe/Paris').utc).toBe(
        '2026-03-29T01:00:00.000Z',
      )
    })

    it('rejects the start of the gap (02:00) itself', () => {
      expect(() => localDateTimeToUtc('2026-03-29T02:00', 'Europe/Paris')).toThrow(
        'does not exist',
      )
    })

    it('handles the New York gap on its own date', () => {
      expect(() => localDateTimeToUtc('2026-03-08T02:30', 'America/New_York')).toThrow(
        'does not exist',
      )
      // The same time is fine in Paris on that date.
      expect(localDateTimeToUtc('2026-03-08T02:30', 'Europe/Paris').utc).toBe(
        '2026-03-08T01:30:00.000Z',
      )
    })

    it('handles a 30-minute daylight-saving change', () => {
      expect(() => localDateTimeToUtc('2026-10-04T02:15', 'Australia/Lord_Howe')).toThrow(
        'does not exist',
      )
      // 02:30 at UTC+11 = 15:30 UTC the previous day
      expect(localDateTimeToUtc('2026-10-04T02:30', 'Australia/Lord_Howe').utc).toBe(
        '2026-10-03T15:30:00.000Z',
      )
    })
  })

  describe('clocks going back (times that happen twice)', () => {
    it('returns the earlier 02:30 in Paris on 2026-10-25 and flags it', () => {
      // First 02:30 is still summer time (UTC+2) = 00:30 UTC.
      // (The second one, at UTC+1, would be 01:30 UTC.)
      expect(localDateTimeToUtc('2026-10-25T02:30', 'Europe/Paris')).toEqual({
        utc: '2026-10-25T00:30:00.000Z',
        ambiguous: true,
      })
    })

    it('does not flag the times just outside the repeated hour', () => {
      // 01:59 at UTC+2 = 23:59 UTC; 03:00 at UTC+1 = 02:00 UTC
      expect(localDateTimeToUtc('2026-10-25T01:59', 'Europe/Paris')).toEqual({
        utc: '2026-10-24T23:59:00.000Z',
        ambiguous: false,
      })
      expect(localDateTimeToUtc('2026-10-25T03:00', 'Europe/Paris')).toEqual({
        utc: '2026-10-25T02:00:00.000Z',
        ambiguous: false,
      })
    })

    it('flags the repeated hour in New York', () => {
      // First 01:30 is EDT (UTC−4) = 05:30 UTC
      expect(localDateTimeToUtc('2026-11-01T01:30', 'America/New_York')).toEqual({
        utc: '2026-11-01T05:30:00.000Z',
        ambiguous: true,
      })
    })
  })

  it('rejects malformed input', () => {
    for (const input of ['2026-11-09 14:30', '2026-11-09', '14:30', '2026-11-09T14:30Z', '']) {
      expect(() => localDateTimeToUtc(input, 'Europe/Paris')).toThrow(
        'Local date-time must use the format YYYY-MM-DDTHH:mm.',
      )
    }
  })

  it('rejects impossible dates and times', () => {
    for (const input of ['2026-02-30T10:00', '2026-13-01T10:00', '2026-11-09T24:00', '2026-11-09T10:60']) {
      expect(() => localDateTimeToUtc(input, 'Europe/Paris')).toThrow('Invalid date or time.')
    }
  })

  it('accepts 29 February only in leap years', () => {
    expect(localDateTimeToUtc('2028-02-29T12:00', 'Europe/Paris').utc).toBe(
      '2028-02-29T11:00:00.000Z',
    )
    expect(() => localDateTimeToUtc('2026-02-29T12:00', 'Europe/Paris')).toThrow(
      'Invalid date or time.',
    )
  })

  it('rejects an invalid timezone', () => {
    expect(() => localDateTimeToUtc('2026-11-09T14:30', 'Mars/Olympus')).toThrow(
      'Invalid IANA timezone.',
    )
  })
})

describe('utcToLocalDateTime and formatInTimezone', () => {
  it('shows a UTC instant as wall-clock time in the event timezone', () => {
    expect(utcToLocalDateTime('2026-11-09T13:30:00.000Z', 'Europe/Paris')).toBe(
      '2026-11-09T14:30',
    )
    expect(utcToLocalDateTime('2026-11-09T13:30:45.000Z', 'Asia/Tokyo', { includeSeconds: true })).toBe(
      '2026-11-09T22:30:45',
    )
  })

  it('round-trips with localDateTimeToUtc', () => {
    for (const zone of ['Europe/Paris', 'America/New_York', 'Asia/Tokyo']) {
      const { utc } = localDateTimeToUtc('2026-07-15T06:45', zone)
      expect(utcToLocalDateTime(utc, zone)).toBe('2026-07-15T06:45')
    }
  })

  it('shows both occurrences of a repeated hour correctly', () => {
    expect(formatInTimezone('2026-10-25T00:30:00.000Z', 'Europe/Paris', 'HH:mm xxx')).toBe(
      '02:30 +02:00',
    )
    expect(formatInTimezone('2026-10-25T01:30:00.000Z', 'Europe/Paris', 'HH:mm xxx')).toBe(
      '02:30 +01:00',
    )
  })

  it('uses the default display pattern', () => {
    expect(formatInTimezone('2026-11-09T05:30:00.000Z', 'Asia/Tokyo')).toBe('2026-11-09 14:30')
  })

  it('rejects invalid input', () => {
    expect(() => formatInTimezone('not a date', 'Europe/Paris')).toThrow('Invalid UTC timestamp.')
    expect(() => formatInTimezone('2026-11-09T05:30:00.000Z', 'Mars/Olympus')).toThrow(
      'Invalid IANA timezone.',
    )
  })
})

describe('getUtcOffsetMinutes', () => {
  it('returns the offset in force at that instant', () => {
    expect(getUtcOffsetMinutes('2026-01-15T12:00:00Z', 'Europe/Paris')).toBe(60)
    expect(getUtcOffsetMinutes('2026-07-15T12:00:00Z', 'Europe/Paris')).toBe(120)
    expect(getUtcOffsetMinutes('2026-07-15T12:00:00Z', 'America/New_York')).toBe(-240)
    expect(getUtcOffsetMinutes('2026-10-04T12:00:00Z', 'Australia/Lord_Howe')).toBe(660)
  })
})

describe('elapsedMilliseconds', () => {
  it('counts 9 hours for a 23:00–07:00 night when clocks go back', () => {
    const start = localDateTimeToUtc('2026-10-24T23:00', 'Europe/Paris').utc
    const end = localDateTimeToUtc('2026-10-25T07:00', 'Europe/Paris').utc

    // The clock difference is 8 hours, but 9 hours actually elapsed.
    expect(elapsedMilliseconds(start, end)).toBe(9 * HOUR_MS)
  })

  it('counts 7 hours for a 23:00–07:00 night when clocks move forward', () => {
    const start = localDateTimeToUtc('2026-03-28T23:00', 'Europe/Paris').utc
    const end = localDateTimeToUtc('2026-03-29T07:00', 'Europe/Paris').utc

    expect(elapsedMilliseconds(start, end)).toBe(7 * HOUR_MS)
  })

  it('counts actual time when travelling between timezones', () => {
    // Leave Paris 22:00 (21:00 UTC), arrive Tokyo 18:00 next day (09:00 UTC).
    const start = localDateTimeToUtc('2026-11-08T22:00', 'Europe/Paris').utc
    const end = localDateTimeToUtc('2026-11-09T18:00', 'Asia/Tokyo').utc

    expect(elapsedMilliseconds(start, end)).toBe(12 * HOUR_MS)
  })

  it('is negative when the end is before the start', () => {
    expect(
      elapsedMilliseconds('2026-11-09T10:00:00Z', '2026-11-09T09:00:00Z'),
    ).toBe(-HOUR_MS)
  })

  it('rejects invalid timestamps', () => {
    expect(() => elapsedMilliseconds('nope', '2026-11-09T09:00:00Z')).toThrow(
      'Invalid UTC timestamp.',
    )
  })
})
