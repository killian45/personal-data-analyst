import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { db } from '../database/db'
import { createHabit } from '../database/habits'
import { DEVICE_IMPORTS_STORAGE_KEY, isDeviceImportOn } from './deviceImports'
import {
  ALL_FEATURES_ON,
  FEATURES_STORAGE_KEY,
  getFeatures,
  isFeatureOn,
  NEW_PERSON_FEATURES,
  parseFeatures,
  resetFeaturesCache,
  setFeatures,
} from './features'
import { isWelcomeDone, needsWelcome, WELCOME_DONE_KEY } from './welcome'

describe('feature switches (sharing plan S4)', () => {
  it('existing installs (nothing stored or unreadable) keep every feature on', () => {
    expect(parseFeatures(null)).toEqual(ALL_FEATURES_ON)
    expect(parseFeatures('not json')).toEqual(ALL_FEATURES_ON)
    expect(parseFeatures('[1]')).toEqual(ALL_FEATURES_ON)
    expect(parseFeatures('{"goals":false,"crm":"no"}')).toEqual({ ...ALL_FEATURES_ON, goals: false })
    expect(getFeatures()).toEqual(ALL_FEATURES_ON)
  })

  it('new people start with the CRM on and the personal features off', () => {
    expect(NEW_PERSON_FEATURES).toEqual({ crm: true, goals: false, location: false, screenTime: false, ynab: false })
  })

  it('saves on this device and is read back after a restart', () => {
    setFeatures(NEW_PERSON_FEATURES)
    setFeatures({ goals: true })
    resetFeaturesCache()
    expect(JSON.parse(localStorage.getItem(FEATURES_STORAGE_KEY) ?? '{}')).toEqual({ ...NEW_PERSON_FEATURES, goals: true })
    expect(isFeatureOn('goals')).toBe(true)
    expect(isFeatureOn('ynab')).toBe(false)
  })

  it('a feature that is off stops its device imports; Health Connect has no feature', () => {
    localStorage.removeItem(DEVICE_IMPORTS_STORAGE_KEY)
    setFeatures({ screenTime: false, location: false, crm: false })
    expect(isDeviceImportOn('screenTime')).toBe(false)
    expect(isDeviceImportOn('location')).toBe(false)
    expect(isDeviceImportOn('contacts')).toBe(false)
    expect(isDeviceImportOn('healthConnect')).toBe(true)
    setFeatures({ screenTime: true })
    expect(isDeviceImportOn('screenTime')).toBe(true)
  })
})

describe('welcome screen: who sees it', () => {
  beforeEach(async () => {
    localStorage.removeItem(WELCOME_DONE_KEY)
    await db.delete()
    await db.open()
  })

  afterEach(async () => {
    db.close()
    await db.delete()
  })

  it('a brand-new empty device sees it', async () => {
    expect(await needsWelcome(db)).toBe(true)
    expect(isWelcomeDone()).toBe(false)
  })

  it('a device that already has data never sees it, keeps every feature, and is marked done', async () => {
    await createHabit({ name: 'Eau', type: 'number', unit: 'ml' })
    expect(await needsWelcome(db)).toBe(false)
    expect(isWelcomeDone()).toBe(true)
    expect(getFeatures()).toEqual(ALL_FEATURES_ON)
    // Even if its data is deleted later, the question is not asked again.
    await db.habits.clear()
    expect(await needsWelcome(db)).toBe(false)
  })

  it('a device linked to sync (but with no data yet) does not see it', async () => {
    await db.syncState.put({ id: 'current' } as never)
    expect(await needsWelcome(db)).toBe(false)
  })
})
