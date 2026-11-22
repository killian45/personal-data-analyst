import { describe, expect, it } from 'vitest'

import type { Entry, Habit } from '../database/types'
import { locationSamples } from '../location/testLocation'
import { screenTimeSample } from '../screenTime/testScreenTime'
import { processSleep } from '../sleep/engine/processSleep'

import { buildMeasures } from './measures'

const T = '2026-11-01T00:00:00.000Z'
const base = { color: '#2563eb', archived: false, sortOrder: 0, syncStatus: 'pending', revision: 1, syncedRevision: null, createdAt: T, updatedAt: T, deletedAt: null } as const

const water = { ...base, id: 'water', name: 'Water', type: 'number', unit: 'ml', dailyAggregation: 'sum', target: null } as unknown as Habit
const gym = { ...base, id: 'gym', name: 'Gym', type: 'checkbox' } as unknown as Habit
const mood = { ...base, id: 'mood', name: 'Mood', type: 'label', labelOptions: ['Good'] } as unknown as Habit

const entry = (habitId: string, habitType: string, value: unknown, day: number): Entry => ({
  id: `${habitId}-${day}`, habitId, habitType, occurredStart: `2026-11-${String(day).padStart(2, '0')}T10:00:00.000Z`, occurredEnd: null,
  timezone: 'Europe/Paris', value, comment: null, source: 'manual', externalId: null, ...base,
}) as unknown as Entry

function data(changes: Record<string, unknown> = {}) {
  return {
    habits: [water, gym, mood],
    entries: [entry('water', 'number', 500, 9), entry('water', 'number', 250, 9), entry('gym', 'checkbox', true, 9)],
    sleep: processSleep([]),
    screenTime: [screenTimeSample('st', '2026-11-09')],
    location: locationSamples(),
    placeNames: {},
    displayTimezone: 'event' as const,
    ...changes,
  }
}

describe('buildMeasures', () => {
  it('lists sleep, number/stopwatch/checkbox habits (not label/text), screen time and location', () => {
    const measures = buildMeasures(data())
    expect(measures.map((m) => [m.id, m.group, m.kind, m.per])).toEqual([
      ['sleep:duration', 'Sleep', 'duration', 'night'],
      ['sleep:timeInBed', 'Sleep', 'duration', 'night'],
      ['sleep:bedtime', 'Sleep', 'clock', 'night'],
      ['sleep:wakeTime', 'Sleep', 'clock', 'night'],
      ['habit:water', 'Habits', 'number', 'day'],
      ['habit:gym', 'Habits', 'binary', 'day'],
      ['screenTime', 'Screen time', 'duration', 'day'],
      ['location:distance', 'Location', 'number', 'day'],
      ['location:active', 'Location', 'duration', 'day'],
      ['location:places', 'Location', 'number', 'day'],
      // The test location data has a Home visit.
      ['location:away:home', 'Location', 'duration', 'day'],
      ['location:in:home', 'Location', 'duration', 'day'],
    ])
    // Same daily values as the Dashboard: water is the day's total.
    expect(measures.find((m) => m.id === 'habit:water')?.daily).toEqual([{ date: '2026-11-09', value: 750 }])
    expect(measures.find((m) => m.id === 'habit:water')?.unit).toBe('ml')
  })

  it('adds "time in" for home, named places and places visited on 3+ days, telling unnamed ones apart', () => {
    const [visit] = locationSamples()
    const day = (n: number, key: string, type = 'UNKNOWN') => ({
      ...visit,
      id: `v-${key}-${n}`,
      dedupeKey: `k-${key}-${n}`,
      startUtc: `2026-11-0${n}T08:00:00.000Z`,
      endUtc: `2026-11-0${n}T10:00:00.000Z`,
      metadata: { ...visit.metadata, placeId: key, semanticType: type },
    })
    const location = [day(1, 'HOME_ID', 'HOME'), day(1, 'GYM'), day(2, 'GYM'), day(3, 'GYM'), day(4, 'RARE'), day(5, 'NAMED')]
    const labels = buildMeasures(data({ location, placeNames: { NAMED: 'Parents' } })).filter((m) => m.id.startsWith('location:in:')).map((m) => m.label)
    expect(labels).toEqual(['Time in Place (3 days, 6 h)', 'Time in Home', 'Time in Parents'])
  })

  it('leaves out screen time and location when there is none', () => {
    const ids = buildMeasures(data({ screenTime: [], location: [] })).map((m) => m.id)
    expect(ids.some((m) => m.startsWith('location') || m === 'screenTime')).toBe(false)
  })

  it('adds formulas last (group "My formulas"), skipping ones whose measures no longer exist', () => {
    const formulas = [
      { id: 'f_double001', name: 'Double water', unit: 'ml', display: 'number' as const, expression: '{habit:water} * 2' },
      { id: 'f_broken001', name: 'Broken', unit: null, display: 'number' as const, expression: '{habit:deleted} + 1' },
    ]
    const measures = buildMeasures(data({ formulas }))
    const last = measures.at(-1)!
    expect([last.id, last.label, last.group, last.kind, last.unit]).toEqual(['formula:f_double001', 'Double water', 'My formulas', 'number', 'ml'])
    expect(last.daily).toEqual([{ date: '2026-11-09', value: 1500 }])
    expect(measures.some((m) => m.id === 'formula:f_broken001')).toBe(false)
  })
})
