import { describe, expect, it } from 'vitest'

import { validateSettingRecord } from '../backup/restore/validateRecords'
import { parseSectionOrder } from '../settings/dashboardOrder'
import { arrangeSections, moveSection, moveVisibleSection } from './sectionOrder'
import { DASHBOARD_HIDDEN_KEY, parseHiddenSections } from '../settings/dashboardHidden'

const SLEEP = ['sleepDuration', 'bedtime', 'wakeTime']

describe('arrangeSections', () => {
  it('uses the spec order when never re-arranged: sleep sections, then habits in the shared order', () => {
    expect(arrangeSections(null, ['a', 'b'])).toEqual([...SLEEP, 'habit:a', 'habit:b'])
  })

  it('keeps the saved places of the sleep sections and fills habit places in the shared habit order', () => {
    const saved = ['habit:b', 'bedtime', 'habit:a', 'sleepDuration', 'wakeTime']
    // Shared habit order is a, b: habit places are filled a then b.
    expect(arrangeSections(saved, ['a', 'b'])).toEqual(['habit:a', 'bedtime', 'habit:b', 'sleepDuration', 'wakeTime'])
  })

  it('adds new habits at the end and drops archived or deleted ones', () => {
    const saved = ['habit:a', 'bedtime', 'habit:gone', 'sleepDuration', 'wakeTime']
    expect(arrangeSections(saved, ['a', 'new'])).toEqual(['habit:a', 'bedtime', 'sleepDuration', 'wakeTime', 'habit:new'])
  })

  it('ignores unknown and repeated ids and restores a missing sleep section first', () => {
    const saved = ['bedtime', 'bedtime', 'mystery', 'habit:a', 'wakeTime']
    expect(arrangeSections(saved, ['a'])).toEqual(['sleepDuration', 'bedtime', 'habit:a', 'wakeTime'])
  })
})

describe('arrangeSections with screen time', () => {
  it('puts the screen-time section last by default and only when it is shown', () => {
    expect(arrangeSections(null, ['a'], { screenTime: true })).toEqual([...SLEEP, 'habit:a', 'screenTime'])
    expect(arrangeSections(null, ['a'])).toEqual([...SLEEP, 'habit:a'])
  })

  it('adds it at the end of a saved layout (after new habits) and keeps a saved place', () => {
    expect(arrangeSections([...SLEEP, 'habit:a'], ['a', 'new'], { screenTime: true })).toEqual([...SLEEP, 'habit:a', 'habit:new', 'screenTime'])
    expect(arrangeSections(['screenTime', ...SLEEP, 'habit:a'], ['a'], { screenTime: true })).toEqual(['screenTime', ...SLEEP, 'habit:a'])
    // Saved but no data any more: hidden.
    expect(arrangeSections(['screenTime', ...SLEEP], [], { screenTime: false })).toEqual(SLEEP)
  })

  it('moving it past a habit changes the layout only', () => {
    const arranged = [...SLEEP, 'habit:a', 'screenTime']
    expect(moveSection(arranged, 4, -1)).toEqual({ kind: 'layout', order: [...SLEEP, 'screenTime', 'habit:a'] })
  })
})

describe('arrangeSections with location', () => {
  it('puts Location after Screen time by default and at the end of a saved layout', () => {
    expect(arrangeSections(null, ['a'], { screenTime: true, location: true })).toEqual([...SLEEP, 'habit:a', 'screenTime', 'location'])
    expect(arrangeSections([...SLEEP, 'screenTime', 'habit:a'], ['a'], { screenTime: true, location: true })).toEqual([...SLEEP, 'screenTime', 'habit:a', 'location'])
    expect(arrangeSections(['location', ...SLEEP], [], { location: false })).toEqual(SLEEP)
  })
})

describe('arrangeSections with formulas', () => {
  it('puts formula sections last (after screen time and location), keeping saved places', () => {
    expect(arrangeSections(null, ['a'], { screenTime: true, location: true, formulaIds: ['f1', 'f2'] })).toEqual([
      ...SLEEP, 'habit:a', 'screenTime', 'location', 'formula:f1', 'formula:f2',
    ])
    expect(arrangeSections(['formula:f2', ...SLEEP], [], { formulaIds: ['f1', 'f2'] })).toEqual(['formula:f2', ...SLEEP, 'formula:f1'])
    expect(arrangeSections(['formula:gone', ...SLEEP], [], { formulaIds: [] })).toEqual(SLEEP)
  })
})

describe('moveSection', () => {
  const arranged = ['sleepDuration', 'bedtime', 'wakeTime', 'habit:a', 'habit:b']

  it('two habits swapped → a new shared habit order', () => {
    expect(moveSection(arranged, 4, -1)).toEqual({ kind: 'habit-order', habitIds: ['b', 'a'] })
  })

  it('a habit moved past a sleep section → a new layout, habit order unchanged', () => {
    expect(moveSection(arranged, 3, -1)).toEqual({
      kind: 'layout',
      order: ['sleepDuration', 'bedtime', 'habit:a', 'wakeTime', 'habit:b'],
    })
  })

  it('two sleep sections swapped → a new layout', () => {
    expect(moveSection(arranged, 1, -1)).toEqual({
      kind: 'layout',
      order: ['bedtime', 'sleepDuration', 'wakeTime', 'habit:a', 'habit:b'],
    })
  })

  it('does nothing at the ends', () => {
    expect(moveSection(arranged, 0, -1)).toEqual({ kind: 'none' })
    expect(moveSection(arranged, 4, 1)).toEqual({ kind: 'none' })
  })

  it('a saved layout applied again gives the same arrangement (round trip)', () => {
    const move = moveSection(arranged, 3, -1)
    if (move.kind !== 'layout') throw new Error('expected a layout move')
    expect(arrangeSections(move.order, ['a', 'b'])).toEqual(move.order)
  })
})

describe('stored section order', () => {
  it('accepts a list of ids and refuses anything else', () => {
    expect(parseSectionOrder('["bedtime","habit:a"]')).toEqual(['bedtime', 'habit:a'])
    expect(parseSectionOrder('{"a":1}')).toBeNull()
    expect(parseSectionOrder('[1]')).toBeNull()
    expect(parseSectionOrder('[""]')).toBeNull()
    expect(parseSectionOrder('nope')).toBeNull()
  })

  it('is validated when restored from a backup or received by sync', () => {
    const base = {
      key: 'dashboard.order', updatedAt: '2026-11-11T08:00:00.000Z', deletedAt: null,
      syncStatus: 'synced', revision: 1, syncedRevision: 1,
    }
    expect(validateSettingRecord({ ...base, value: '["bedtime"]' }).value).toBe('["bedtime"]')
    expect(() => validateSettingRecord({ ...base, value: '{"x":1}' })).toThrow('invalid dashboard section order')
  })
})

describe('moveVisibleSection (hidden panels are skipped)', () => {
  const arranged = ['sleepDuration', 'bedtime', 'wakeTime', 'habit:a', 'screenTime', 'habit:b']

  it('swaps with the next visible panel; hidden ones keep their places', () => {
    const hidden = new Set(['bedtime', 'screenTime'])
    // Visible: sleepDuration, wakeTime, habit:a, habit:b
    expect(moveVisibleSection(arranged, hidden, 1, -1)).toEqual({
      kind: 'layout', order: ['wakeTime', 'bedtime', 'sleepDuration', 'habit:a', 'screenTime', 'habit:b'],
    })
    // Two habits across a hidden panel: the shared habit order changes.
    expect(moveVisibleSection(arranged, hidden, 3, -1)).toEqual({ kind: 'habit-order', habitIds: ['b', 'a'] })
  })

  it('does nothing at the ends of the visible list', () => {
    const hidden = new Set(['sleepDuration'])
    expect(moveVisibleSection(arranged, hidden, 0, -1)).toEqual({ kind: 'none' })
    expect(moveVisibleSection(arranged, hidden, 4, 1)).toEqual({ kind: 'none' })
  })
})

describe('hidden panels setting', () => {
  it('reads a list of ids, removing duplicates; refuses anything else', () => {
    expect(parseHiddenSections('["bedtime","bedtime","habit:a"]')).toEqual(['bedtime', 'habit:a'])
    expect(parseHiddenSections('[]')).toEqual([])
    expect(parseHiddenSections('{"a":1}')).toBeNull()
    expect(parseHiddenSections('[""]')).toBeNull()
    expect(parseHiddenSections('not json')).toBeNull()
  })

  it('is checked in backups and sync', () => {
    const base = { key: DASHBOARD_HIDDEN_KEY, updatedAt: '2026-11-12T10:00:00.000Z', syncStatus: 'pending', revision: 1, syncedRevision: null, deletedAt: null }
    expect(validateSettingRecord({ ...base, value: '["bedtime"]' }).value).toBe('["bedtime"]')
    expect(() => validateSettingRecord({ ...base, value: '[1]' })).toThrow('invalid list of hidden dashboard panels')
  })
})

