import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { db } from '../database/db'

import {
  clockTargetToAxisHours,
  isValidSleepTargetValue,
  loadSleepTargets,
  parseDurationHM,
  saveSleepTargets,
} from './sleepTargets'

describe('parseDurationHM', () => {
  it('reads hours and minutes in several notations', () => {
    expect(parseDurationHM('7:30')).toBe(450)
    expect(parseDurationHM('7h30')).toBe(450)
    expect(parseDurationHM('8')).toBe(480)
    expect(parseDurationHM('0:01')).toBe(1)
  })

  it('rejects invalid durations', () => {
    for (const text of ['', '7:60', '24:00', '0:00', 'eight', '7:5']) {
      expect(parseDurationHM(text)).toBeNull()
    }
  })
})

describe('clockTargetToAxisHours', () => {
  it('places bedtime targets before noon after midnight', () => {
    expect(clockTargetToAxisHours('23:00', 'bedtime')).toBe(23)
    expect(clockTargetToAxisHours('00:30', 'bedtime')).toBe(24.5)
    expect(clockTargetToAxisHours('12:00', 'bedtime')).toBe(12)
  })

  it('places wake targets before 20:00 on the next morning', () => {
    expect(clockTargetToAxisHours('07:00', 'wakeTime')).toBe(31)
    expect(clockTargetToAxisHours('13:30', 'wakeTime')).toBe(37.5)
    expect(clockTargetToAxisHours('20:00', 'wakeTime')).toBe(20)
  })
})

describe('isValidSleepTargetValue', () => {
  it('accepts only the stored formats', () => {
    expect(isValidSleepTargetValue('target.sleepDuration', '7:30')).toBe(true)
    expect(isValidSleepTargetValue('target.sleepDuration', '7h30')).toBe(false)
    expect(isValidSleepTargetValue('target.bedtime', '23:00')).toBe(true)
    expect(isValidSleepTargetValue('target.bedtime', '11 PM')).toBe(false)
    expect(isValidSleepTargetValue('displayTimezone', 'anything')).toBe(true)
  })
})

describe('saving and loading sleep targets', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(async () => {
    db.close()
    await db.delete()
  })

  it('has no targets by default', async () => {
    expect(await loadSleepTargets()).toEqual({ sleepDurationMinutes: null, bedtime: null, wakeTime: null })
  })

  it('saves typed targets in normalised form and removes empty ones', async () => {
    await saveSleepTargets({ sleepDuration: '7h30', bedtime: '23h00', wakeTime: '7:00' })

    expect(await loadSleepTargets()).toEqual({ sleepDurationMinutes: 450, bedtime: '23:00', wakeTime: '07:00' })
    expect((await db.settings.get('target.sleepDuration'))?.value).toBe('7:30')

    await saveSleepTargets({ sleepDuration: '', bedtime: '23:00', wakeTime: '' })

    expect(await loadSleepTargets()).toEqual({ sleepDurationMinutes: null, bedtime: '23:00', wakeTime: null })
    // Removed targets are soft-deleted (so the removal can be synchronised),
    // keeping their last value.
    expect(await db.settings.get('target.wakeTime')).toMatchObject({
      value: '07:00',
      deletedAt: expect.any(String),
      syncStatus: 'pending',
      revision: 2,
    })
    // An unchanged target is not rewritten.
    expect(await db.settings.get('target.bedtime')).toMatchObject({ revision: 1 })

    // Setting it again brings it back.
    await saveSleepTargets({ sleepDuration: '', bedtime: '23:00', wakeTime: '6:45' })
    expect((await loadSleepTargets()).wakeTime).toBe('06:45')
    expect(await db.settings.get('target.wakeTime')).toMatchObject({ deletedAt: null, revision: 3 })
  })

  it('saves nothing when one value is invalid', async () => {
    await saveSleepTargets({ sleepDuration: '8:00', bedtime: '', wakeTime: '' })

    await expect(saveSleepTargets({ sleepDuration: '7:00', bedtime: '11 PM', wakeTime: '' })).rejects.toThrow(
      'Bedtime target: use the 24-hour clock',
    )
    expect((await loadSleepTargets()).sleepDurationMinutes).toBe(480)
  })
})
