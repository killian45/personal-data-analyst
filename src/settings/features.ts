/**
 * Optional features (sharing plan S4, PROJECT_SPEC.md "Sharing").
 *
 * New people start with a simple app: the Personal CRM on, the personal
 * features (Goals with local AI, YNAB, location, screen time) off. They
 * choose on the welcome screen and change it later in Settings & Data →
 * Features.
 *
 * A feature that is off: its page and import panels are hidden, its
 * automatic and background imports stop, and its Dashboard panels and
 * Analysis measures are not shown. NOTHING is deleted; turning it on again
 * shows everything as before.
 *
 * Stored in this device's localStorage (not synced, not in backups), like
 * the language and the device import switches. Missing or unreadable
 * values count as ON, so existing installs (the owner's computer, phone and
 * tablet) keep every feature without doing anything.
 */

export const FEATURES_STORAGE_KEY = 'pda.features'

export const FEATURES = ['crm', 'goals', 'location', 'screenTime', 'ynab'] as const
export type Feature = (typeof FEATURES)[number]
export type FeatureSwitches = Readonly<Record<Feature, boolean>>

/** Existing installs, and anything unreadable: everything on. */
export const ALL_FEATURES_ON: FeatureSwitches = { crm: true, goals: true, location: true, screenTime: true, ynab: true }

/** What the welcome screen proposes to new people (owner decision 2026-11-21: CRM on). */
export const NEW_PERSON_FEATURES: FeatureSwitches = { crm: true, goals: false, location: false, screenTime: false, ynab: false }

/** Reads the stored value; anything missing or not a boolean counts as on. */
export function parseFeatures(text: string | null): FeatureSwitches {
  if (text === null) return ALL_FEATURES_ON
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return ALL_FEATURES_ON
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return ALL_FEATURES_ON
  const record = value as Record<string, unknown>
  const result = { ...ALL_FEATURES_ON }
  for (const feature of FEATURES) {
    if (typeof record[feature] === 'boolean') result[feature] = record[feature]
  }
  return result
}

const listeners = new Set<() => void>()
let cached: FeatureSwitches | null = null

export function getFeatures(): FeatureSwitches {
  if (cached === null) {
    try {
      cached = parseFeatures(localStorage.getItem(FEATURES_STORAGE_KEY))
    } catch {
      cached = ALL_FEATURES_ON
    }
  }
  return cached
}

export function isFeatureOn(feature: Feature): boolean {
  return getFeatures()[feature]
}

/** Saves all switches at once (welcome screen) or one switch (Settings). */
export function setFeatures(next: Partial<Record<Feature, boolean>>): void {
  const merged = { ...getFeatures(), ...next }
  cached = merged
  try {
    localStorage.setItem(FEATURES_STORAGE_KEY, JSON.stringify(merged))
  } catch (caught) {
    console.error('Could not save the feature switches:', caught)
  }
  for (const listener of listeners) listener()
}

/** For useSyncExternalStore. */
export function subscribeFeatures(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Tests only: forget the cached value (localStorage was changed directly). */
export function resetFeaturesCache(): void {
  cached = null
}
