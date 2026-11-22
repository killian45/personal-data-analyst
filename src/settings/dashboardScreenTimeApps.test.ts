import { describe, expect, it } from 'vitest'

import { validateSettingRecord } from '../backup/restore/validateRecords'

import { chosenNames, DASHBOARD_SCREEN_TIME_APPS_KEY, MAX_CHOSEN_APPS, parseChosenApps, toggleChosenApp } from './dashboardScreenTimeApps'

describe('chosen apps keep their colour slots', () => {
  it('removing an app frees its slot without moving the others; a new app fills the first free slot', () => {
    let slots = toggleChosenApp([], 'Chat')
    slots = toggleChosenApp(slots, 'Maps')
    slots = toggleChosenApp(slots, 'Camera')
    expect(slots).toEqual(['Chat', 'Maps', 'Camera'])
    slots = toggleChosenApp(slots, 'Maps')
    expect(slots).toEqual(['Chat', null, 'Camera']) // Camera keeps slot 3
    slots = toggleChosenApp(slots, 'Mail')
    expect(slots).toEqual(['Chat', 'Mail', 'Camera'])
    expect(toggleChosenApp(['Chat', null, 'Camera'], 'Camera')).toEqual(['Chat']) // trailing free slots removed
    expect(chosenNames(['Chat', null, 'Camera'])).toEqual(['Chat', 'Camera'])
  })

  it('at most 8 apps (8 colours); a 9th is not added', () => {
    const full = Array.from({ length: MAX_CHOSEN_APPS }, (_, index) => `App ${index}`)
    expect(MAX_CHOSEN_APPS).toBe(8)
    expect(toggleChosenApp(full, 'One more')).toEqual(full)
  })

  it('reads the stored value, including older ones without free slots; refuses broken ones', () => {
    expect(parseChosenApps('["Chat","Maps"]')).toEqual(['Chat', 'Maps'])
    expect(parseChosenApps('["Chat",null,"Maps",null]')).toEqual(['Chat', null, 'Maps'])
    expect(parseChosenApps('["Chat","Chat"]')).toBeNull()
    expect(parseChosenApps('[""]')).toBeNull()
    expect(parseChosenApps(JSON.stringify(Array.from({ length: 9 }, (_, i) => `A${i}`)))).toBeNull()
    const base = { key: DASHBOARD_SCREEN_TIME_APPS_KEY, updatedAt: '2026-11-12T10:00:00.000Z', syncStatus: 'pending', revision: 1, syncedRevision: null, deletedAt: null }
    expect(validateSettingRecord({ ...base, value: '[null,"Maps"]' }).value).toBe('[null,"Maps"]')
    expect(() => validateSettingRecord({ ...base, value: '[1]' })).toThrow('invalid list of screen-time apps')
  })
})
