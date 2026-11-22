import { commentTemplate } from '../logging/commentTemplate'
import { describe, expect, it } from 'vitest'

import type { SleepSession } from '../database/types'
import { buildTimeRange } from '../logging/buildTimeRange'

import { buildSleepInput } from './buildSleepInput'
import { buildSleepUpdate, initialSleepEditForm } from './buildSleepUpdate'

const HOUR = 3_600_000

const night = {
  startDate: '08/11/2026',
  startTime: '23:30',
  endDate: '09/11/2026',
  endTime: '07:15',
  timezone: 'Europe/Paris',
}

describe('buildTimeRange', () => {
  it('uses the sleep words in its messages', () => {
    const labels = 'sleep' as const

    expect(() => buildTimeRange({ ...night, startTime: '11 PM' }, labels)).toThrow(
      'Enter a valid bedtime date (dd/mm/yyyy) and a 24-hour time',
    )
    expect(() => buildTimeRange({ ...night, endTime: '23:00', endDate: '08/11/2026' }, labels)).toThrow(
      'The wake time must be after the bedtime.',
    )
    expect(() =>
      buildTimeRange({ ...night, startDate: '29/03/2026', startTime: '02:30', endDate: '29/03/2026' }, labels),
    ).toThrow('Bedtime: This time does not exist in Europe/Paris')
  })
})

describe('buildSleepInput', () => {
  it('builds a manual sleep input across midnight', () => {
    const built = buildSleepInput({ ...night, comment: 'Woke once' })

    // 23:30 and 07:15 in Paris (UTC+1)
    expect(built.input).toEqual({
      startUtc: '2026-11-08T22:30:00.000Z',
      endUtc: '2026-11-09T06:15:00.000Z',
      timezone: 'Europe/Paris',
      comment: 'Woke once',
    })
    expect(built.durationMs).toBe(7.75 * HOUR)
  })

  it('measures 9 hours for 23:00–07:00 on the night the clocks go back', () => {
    const built = buildSleepInput({
      ...night,
      startDate: '24/10/2026',
      startTime: '23:00',
      endDate: '25/10/2026',
      endTime: '07:00',
      comment: '',
    })

    expect(built.durationMs).toBe(9 * HOUR)
  })

  it('refuses more than 48 hours', () => {
    expect(() =>
      buildSleepInput({ ...night, endDate: '11/11/2026', comment: '' }),
    ).toThrow('A sleep session cannot last more than 48 hours.')
  })
})

describe('buildSleepUpdate', () => {
  const manual: SleepSession = {
    id: 's1',
    source: 'manual',
    externalId: null,
    sourceApp: null,
    dedupeKey: 'manual:s1',
    // 23:30:20 Paris: the seconds must survive edits of other fields.
    startUtc: '2026-11-08T22:30:20.000Z',
    endUtc: '2026-11-09T06:15:00.000Z',
    timezone: 'Europe/Paris',
    startOffsetMinutes: null,
    endOffsetMinutes: null,
    stages: [],
    reportedSleepMs: null,
    comment: null,
    importedAt: null,
    metadata: null,
    syncStatus: 'pending',
    revision: 1,
    syncedRevision: null,
    createdAt: '2026-11-09T07:00:00.000Z',
    updatedAt: '2026-11-09T07:00:00.000Z',
    deletedAt: null,
  }

  const imported: SleepSession = {
    ...manual,
    id: 'hc1',
    source: 'health_connect',
    externalId: 'abc',
    dedupeKey: 'health_connect:id:abc',
    timezone: null,
    startOffsetMinutes: 60,
    endOffsetMinutes: 60,
  }

  it('shows the session in its timezone, or at its UTC offset', () => {
    expect(initialSleepEditForm(manual)).toEqual({
      startDate: '08/11/2026',
      startTime: '23:30',
      endDate: '09/11/2026',
      endTime: '07:15',
      timezone: 'Europe/Paris',
      comment: commentTemplate(),
    })
    expect(initialSleepEditForm(imported).timezone).toBe('+01:00')
  })

  it('sends only changed fields and keeps the exact original bedtime', () => {
    const { changes } = buildSleepUpdate(manual, {
      ...initialSleepEditForm(manual),
      endTime: '07:45',
      comment: 'Alarm late',
    })

    expect(changes).toEqual({ endUtc: '2026-11-09T06:45:00.000Z', comment: 'Alarm late' })
  })

  it('keeps the wall-clock times when the timezone changes', () => {
    const { changes } = buildSleepUpdate(manual, {
      ...initialSleepEditForm(manual),
      timezone: 'Asia/Tokyo',
    })

    // 23:30 and 07:15 in Tokyo (UTC+9)
    expect(changes).toEqual({
      timezone: 'Asia/Tokyo',
      startUtc: '2026-11-08T14:30:00.000Z',
      endUtc: '2026-11-08T22:15:00.000Z',
    })
  })

  it('refuses a wake time before the bedtime', () => {
    expect(() =>
      buildSleepUpdate(manual, { ...initialSleepEditForm(manual), endDate: '08/11/2026', endTime: '22:00' }),
    ).toThrow('The wake time must be after the bedtime.')
  })

  it('saving the untouched comment prompts changes nothing', () => {
    expect(buildSleepUpdate(manual, initialSleepEditForm(manual)).changes).toEqual({})
  })

  it('only changes the comment of an imported session', () => {
    const { changes } = buildSleepUpdate(imported, {
      ...initialSleepEditForm(imported),
      endTime: '09:00',
      comment: 'Restless',
    })

    expect(changes).toEqual({ comment: 'Restless' })
  })
})
