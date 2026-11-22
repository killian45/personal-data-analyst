import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_DEVICE_IMPORTS,
  DEVICE_IMPORTS_STORAGE_KEY,
  getDeviceImports,
  isDeviceImportOn,
  parseDeviceImports,
  resetDeviceImportsCacheForTests,
  setDeviceImport,
  subscribeDeviceImports,
} from './deviceImports'

beforeEach(() => {
  localStorage.clear()
  resetDeviceImportsCacheForTests()
})

describe('parseDeviceImports', () => {
  it('treats a missing value as all on (existing installs unchanged)', () => {
    expect(parseDeviceImports(null)).toEqual({ location: true, screenTime: true, healthConnect: true, contacts: true })
  })

  it('treats unreadable or wrongly shaped values as all on', () => {
    for (const text of ['not json', '42', 'null', '[]', '"off"']) {
      expect(parseDeviceImports(text)).toEqual(DEFAULT_DEVICE_IMPORTS)
    }
  })

  it('keeps stored booleans and fills in missing kinds as on', () => {
    expect(parseDeviceImports('{"screenTime":false,"contacts":false}')).toEqual({
      location: true, screenTime: false, healthConnect: true, contacts: false,
    })
  })

  it('ignores non-boolean values and unknown kinds', () => {
    expect(parseDeviceImports('{"location":"no","healthConnect":0,"other":false}')).toEqual(DEFAULT_DEVICE_IMPORTS)
  })
})

describe('device import switches', () => {
  it('saves a switch on this device and reads it back after a restart', () => {
    setDeviceImport('healthConnect', false)
    expect(isDeviceImportOn('healthConnect')).toBe(false)
    expect(JSON.parse(localStorage.getItem(DEVICE_IMPORTS_STORAGE_KEY) ?? '')).toEqual({
      location: true, screenTime: true, healthConnect: false, contacts: true,
    })

    resetDeviceImportsCacheForTests()
    expect(getDeviceImports()).toEqual({ location: true, screenTime: true, healthConnect: false, contacts: true })

    setDeviceImport('healthConnect', true)
    expect(isDeviceImportOn('healthConnect')).toBe(true)
  })

  it('changes only the chosen kind', () => {
    setDeviceImport('location', false)
    setDeviceImport('contacts', false)
    expect(getDeviceImports()).toEqual({ location: false, screenTime: true, healthConnect: true, contacts: false })
  })

  it('tells listeners about changes until they unsubscribe', () => {
    const listener = vi.fn()
    const stop = subscribeDeviceImports(listener)
    setDeviceImport('screenTime', false)
    expect(listener).toHaveBeenCalledTimes(1)
    stop()
    setDeviceImport('screenTime', true)
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
