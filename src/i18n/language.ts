/**
 * The current language and plural rules (sharing plan S2). Separate from
 * index.ts so the message files can use plural() without importing the
 * catalogues (no import cycle).
 */

export type Language = 'en' | 'fr'

export const LANGUAGES: readonly Language[] = ['en', 'fr']

/** Each language's name in that language (shown as is in every language). */
export const LANGUAGE_NAMES: Record<Language, string> = { en: 'English', fr: 'Français' }

/** Languages whose texts are machine translations not yet checked by a native speaker. */
export const UNCHECKED_LANGUAGES: readonly Language[] = ['fr']

/**
 * The language chosen on this device (sharing plan S3). Kept in this
 * device's localStorage, like the other device choices: not synced, not
 * in backups. Missing = follow the device's language.
 */
export const LANGUAGE_STORAGE_KEY = 'pda.language'

function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value)
}

/** The language chosen in Settings, or null when the app follows the device. */
export function savedLanguage(): Language | null {
  try {
    const value = globalThis.localStorage?.getItem(LANGUAGE_STORAGE_KEY)
    return isLanguage(value) ? value : null
  } catch {
    return null
  }
}

/** Saves the choice (null: follow the device). The app restarts to apply it. */
export function saveLanguage(language: Language | null): void {
  if (language === null) globalThis.localStorage?.removeItem(LANGUAGE_STORAGE_KEY)
  else globalThis.localStorage?.setItem(LANGUAGE_STORAGE_KEY, language)
}

/** The first of the device's preferred languages that the app has; English otherwise. */
export function deviceLanguage(preferred: readonly string[] = globalThis.navigator?.languages ?? []): Language {
  for (const tag of preferred) {
    const base = tag.toLowerCase().split('-')[0]
    if (isLanguage(base)) return base
  }
  return 'en'
}

/** The language to use when the app starts: the saved choice, else the device's. */
export function startLanguage(): Language {
  return savedLanguage() ?? deviceLanguage()
}

let currentLanguage: Language = 'en'

export function getLanguage(): Language {
  return currentLanguage
}

/** Sets the language (at start-up, before the first render; tests). */
export function setLanguage(language: Language): void {
  currentLanguage = language
  if (typeof document !== 'undefined') document.documentElement.lang = language
}

export interface PluralForms {
  /** Used for 1 in English (and for 0 and 1 in French). */
  one: string
  other: string
  /** Only for languages that have them (not needed for en/fr). */
  zero?: string
  two?: string
  few?: string
  many?: string
}

const pluralRules = new Map<Language, Intl.PluralRules>()

/** Picks the plural form for count in the current language (Intl rules). */
export function plural(count: number, forms: PluralForms): string {
  let rules = pluralRules.get(currentLanguage)
  if (!rules) {
    rules = new Intl.PluralRules(currentLanguage)
    pluralRules.set(currentLanguage, rules)
  }
  const category = rules.select(count)
  if (category === 'one' || category === 'other') return forms[category]
  return forms[category] ?? forms.other
}
