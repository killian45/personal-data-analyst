import { describe, expect, it } from 'vitest'

import { describeSuccess, parseTarget, targetText } from './goalFormat'

const duration = { kind: 'duration' as const, id: 'sleep:duration', unit: null, label: 'Sleep duration' }
const bedtime = { kind: 'clock' as const, id: 'sleep:bedtime', unit: null, label: 'Bedtime' }
const steps = { kind: 'number' as const, id: 'health:steps', unit: 'steps', label: 'Steps' }
const habit = { kind: 'binary' as const, id: 'habit:x', unit: null, label: 'Meditate' }

describe('targets as typed', () => {
  it('durations as h:mm or hours; clock times on the after-midnight axis; numbers', () => {
    expect(parseTarget(duration, '7:30')).toBe(7.5)
    expect(parseTarget(duration, '2')).toBe(2)
    expect(parseTarget(duration, '7:75')).toBeNull()
    expect(parseTarget(bedtime, '23:00')).toBe(23)
    expect(parseTarget(bedtime, '00:30')).toBe(24.5) // after midnight
    expect(parseTarget(steps, '10000')).toBe(10000)
    expect(parseTarget(steps, '7,5')).toBe(7.5)
    expect(parseTarget(steps, 'lots')).toBeNull()
    expect(parseTarget(habit, '')).toBe(1)
    expect(targetText(duration, 7.5)).toBe('7:30')
    expect(targetText(bedtime, 24.5)).toBe('00:30')
  })

  it('describes success in one sentence', () => {
    expect(describeSuccess({ success: { measure: 'sleep:duration', rule: 'mean-at-least', target: 7.5, share: null } }, duration)).toBe('Sleep duration: average per day at least 7 h 30 min')
    expect(describeSuccess({ success: { measure: 'habit:x', rule: 'days-at-least', target: 1, share: 80 } }, habit)).toBe('Meditate: done on at least 80 % of days')
  })
})
