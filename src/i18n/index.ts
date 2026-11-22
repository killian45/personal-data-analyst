/**
 * Screen texts in several languages (sharing plan S2, docs/SHARING_PLAN.md).
 *
 * - en.ts holds every text in English and defines the shape (Messages).
 *   Other languages are objects of the same type, so a missing or extra
 *   text is a TypeScript error (the build fails).
 * - No library: plurals use the browser's Intl.PluralRules (language.ts).
 * - One language for the whole app, chosen when the app starts. Changing
 *   it restarts the app (like changing the sync server), so components and
 *   non-React code simply call messages() — no provider to pass around.
 * - Not translated: the user's own data (habit names, labels, notes) and
 *   stored values.
 */

import { en, type Messages } from './en'
import { fr } from './fr'
import { getLanguage, type Language } from './language'

export type { Messages }
export {
  deviceLanguage,
  getLanguage,
  LANGUAGE_NAMES,
  LANGUAGE_STORAGE_KEY,
  LANGUAGES,
  UNCHECKED_LANGUAGES,
  plural,
  saveLanguage,
  savedLanguage,
  setLanguage,
  startLanguage,
  type Language,
  type PluralForms,
} from './language'
export { dateLocale, formatNumber, numberLocale } from './formats'

const CATALOGUES: Record<Language, Messages> = { en, fr }

/** The texts of every language (e.g. to recognise words saved in any of them). */
export function allMessages(): readonly Messages[] {
  return Object.values(CATALOGUES)
}

/** The texts of the current language. */
export function messages(): Messages {
  return CATALOGUES[getLanguage()]
}
