/**
 * Date and number conventions of the current language (sharing plan S2j).
 *
 * - Numeric dates and times stay dd/mm/yyyy and 24-hour in every language
 *   (the owner's choice, and the French convention too): the patterns in
 *   the code are fixed; only month and weekday NAMES and number separators
 *   follow the language ("Mon 9 Nov 2026" → "lun. 9 nov. 2026",
 *   "1,234.5" → "1 234,5").
 * - English uses British conventions, which is exactly what the app
 *   showed before S2j.
 * - The device's region is never followed (owner decision 2026-11-21):
 *   dates are always typed and shown day/month/year, 24-hour.
 */

import type { Locale } from 'date-fns'
import { enGB, fr } from 'date-fns/locale'

import { getLanguage, type Language } from './language'

const NUMBER_LOCALES: Record<Language, string> = { en: 'en-GB', fr: 'fr-FR' }
const DATE_LOCALES: Record<Language, Locale> = { en: enGB, fr }

/** BCP 47 locale for Intl number formatting in the current language. */
export function numberLocale(): string {
  return NUMBER_LOCALES[getLanguage()]
}

/** date-fns locale (month and weekday names) for the current language. */
export function dateLocale(): Locale {
  return DATE_LOCALES[getLanguage()]
}

const numberFormats = new Map<string, Intl.NumberFormat>()

/** A number with the current language's separators (at most 2 decimals unless options say otherwise). */
export function formatNumber(value: number, options: Intl.NumberFormatOptions = { maximumFractionDigits: 2 }): string {
  const key = `${numberLocale()}|${JSON.stringify(options)}`
  let format = numberFormats.get(key)
  if (!format) {
    format = new Intl.NumberFormat(numberLocale(), options)
    numberFormats.set(key, format)
  }
  return format.format(value)
}
