import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { db } from '../database/db'

import { loadAwayPlace, loadPlaceNames, parsePlaceNames, saveAwayPlace, savePlaceName } from './dashboardLocation'

describe('place names and the chosen place', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(async () => {
    db.close()
    await db.delete()
  })

  it('parses only valid name lists', () => {
    expect(parsePlaceNames('{"A":"Gym","home":"My flat"}')).toEqual({ A: 'Gym', home: 'My flat' })
    for (const text of ['[]', '{"A":""}', '{"A":3}', `{"A":"${'x'.repeat(101)}"}`, 'nope']) expect(parsePlaceNames(text)).toBeNull()
  })

  it('saves, trims and removes names, and remembers the chosen place (home by default)', async () => {
    expect(await loadPlaceNames()).toEqual({})
    expect(await savePlaceName('A', '  Gym  ')).toEqual({ A: 'Gym' })
    expect(await savePlaceName('B', 'Parents')).toEqual({ A: 'Gym', B: 'Parents' })
    expect(await savePlaceName('A', '')).toEqual({ B: 'Parents' })
    await expect(savePlaceName('A', 'x'.repeat(101))).rejects.toThrow(/at most 100/)

    expect(await loadAwayPlace()).toBe('home')
    await saveAwayPlace('B')
    expect(await loadAwayPlace()).toBe('B')
  })
})
