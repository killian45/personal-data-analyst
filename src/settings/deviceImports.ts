/**
 * Per-device import switches (Android app, 2026-11-17).
 *
 * Each device decides which kinds of its OWN data it imports, e.g. a
 * tablet that only shows and logs data while the phone imports screen
 * time and Health Connect. A switch that is off stops the automatic import
 * of that kind and hides its import panels on this device. It never
 * deletes anything and does not change what sync sends or receives:
 * data imported on other devices still arrives here.
 *
 * Stored in this device's localStorage (not a synced setting, not in
 * backups), like the automatic-import state. Missing or unreadable values
 * count as on, so existing installs keep working as before.
 */

import { isFeatureOn, type Feature } from './features'

export const DEVICE_IMPORTS_STORAGE_KEY = 'pda.deviceImports'

export const DEVICE_IMPORT_KINDS = ['location', 'screenTime', 'healthConnect', 'contacts'] as const
export type DeviceImportKind = (typeof DEVICE_IMPORT_KINDS)[number]
export type DeviceImportSwitches = Readonly<Record<DeviceImportKind, boolean>>

export const DEFAULT_DEVICE_IMPORTS: DeviceImportSwitches = {
  location: true,
  screenTime: true,
  healthConnect: true,
  contacts: true,
}

/** Reads the stored value; anything missing or not a boolean counts as on. */
export function parseDeviceImports(text: string | null): DeviceImportSwitches {
  if (text === null) return DEFAULT_DEVICE_IMPORTS
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return DEFAULT_DEVICE_IMPORTS
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return DEFAULT_DEVICE_IMPORTS
  const record = value as Record<string, unknown>
  const result = { ...DEFAULT_DEVICE_IMPORTS }
  for (const kind of DEVICE_IMPORT_KINDS) {
    if (typeof record[kind] === 'boolean') result[kind] = record[kind]
  }
  return result
}

const listeners = new Set<() => void>()
let cached: DeviceImportSwitches | null = null

export function getDeviceImports(): DeviceImportSwitches {
  if (cached === null) {
    try {
      cached = parseDeviceImports(localStorage.getItem(DEVICE_IMPORTS_STORAGE_KEY))
    } catch {
      cached = DEFAULT_DEVICE_IMPORTS
    }
  }
  return cached
}

/** The optional feature each kind belongs to (sharing plan S4); Health Connect has none. */
export const DEVICE_IMPORT_FEATURE: Readonly<Record<DeviceImportKind, Feature | null>> = {
  location: 'location',
  screenTime: 'screenTime',
  healthConnect: null,
  contacts: 'crm',
}

/** Whether the kind's feature is on (always true for Health Connect). */
export function isDeviceImportAvailable(kind: DeviceImportKind): boolean {
  const feature = DEVICE_IMPORT_FEATURE[kind]
  return feature === null || isFeatureOn(feature)
}

/** On when the device switch is on AND the kind's optional feature is on. */
export function isDeviceImportOn(kind: DeviceImportKind): boolean {
  return getDeviceImports()[kind] && isDeviceImportAvailable(kind)
}

export function setDeviceImport(kind: DeviceImportKind, on: boolean): void {
  const next = { ...getDeviceImports(), [kind]: on }
  cached = next
  try {
    localStorage.setItem(DEVICE_IMPORTS_STORAGE_KEY, JSON.stringify(next))
  } catch (error) {
    console.error('Could not save the import switch:', error)
  }
  for (const listener of listeners) listener()
}

export function subscribeDeviceImports(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Tests only: forget the in-memory copy so the next read comes from storage. */
export function resetDeviceImportsCacheForTests(): void {
  cached = null
}
