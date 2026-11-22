import type { ContactBirthday } from '../database/types'
import { messages } from '../i18n'

/**
 * Rules for Personal CRM fields (pure, no database). Used when saving
 * (src/database/contacts.ts, contactInteractions.ts) and when checking
 * records from a backup (src/backup/restore/validateRecords.ts).
 */

export const MAX_CONTACT_NAME_LENGTH = 200
export const MAX_CONTACT_TEXT_LENGTH = 5000
export const MAX_INTERACTION_TEXT_LENGTH = 10000
export const MAX_EXTERNAL_PHONE_ID_LENGTH = 200

/** The free-text detail fields of a contact, in display order. */
export const CONTACT_TEXT_FIELDS = ['description', 'education', 'address', 'interests', 'dislikes'] as const
export type ContactTextField = (typeof CONTACT_TEXT_FIELDS)[number]

/* Getters: the text of the current language is read when used (sharing plan S2i). */
export const CONTACT_FIELD_LABELS: Record<ContactTextField | 'name' | 'birthday', string> = {
  get name() { return messages().labels.contactFields.name },
  get description() { return messages().labels.contactFields.description },
  get education() { return messages().labels.contactFields.education },
  get address() { return messages().labels.contactFields.address },
  get birthday() { return messages().labels.contactFields.birthday },
  get interests() { return messages().labels.contactFields.interests },
  get dislikes() { return messages().labels.contactFields.dislikes },
}

const FULL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const DAY_MONTH = /^--(\d{2})-(\d{2})$/

function daysInMonth(month: number, year: number | null): number {
  if (month === 2) {
    // Without a year, 29 February is allowed (it may be a leap-day birthday).
    if (year === null) return 29
    return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31
}

/** Trims a required name; throws if empty or too long. */
export function normalizeContactName(value: unknown): string {
  if (typeof value !== 'string') throw new Error(messages().inputText.nameText)
  const name = value.trim()
  if (name.length === 0) throw new Error(messages().inputText.nameRequired)
  if (name.length > MAX_CONTACT_NAME_LENGTH) {
    throw new Error(messages().inputText.nameTooLong(MAX_CONTACT_NAME_LENGTH))
  }
  return name
}

/** Trims an optional text field; empty → null. Throws if not text or too long. */
export function normalizeContactText(value: unknown, label: string, maxLength = MAX_CONTACT_TEXT_LENGTH): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') throw new Error(`${label} must be text.`)
  const text = value.trim()
  if (text.length > maxLength) throw new Error(`${label} cannot exceed ${maxLength} characters.`)
  return text || null
}

/**
 * Checks a birthday: "YYYY-MM-DD" (a real calendar date, year 1000–9999)
 * or "--MM-DD" (day and month only). Empty → null.
 */
export function normalizeBirthday(value: unknown): ContactBirthday | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') throw new Error(messages().inputText.birthdayText)
  const text = value.trim()
  if (text === '') return null

  const full = FULL_DATE.exec(text)
  const partial = DAY_MONTH.exec(text)
  const parts = full ? [full[1], full[2], full[3]] : partial ? [null, partial[1], partial[2]] : null
  if (!parts) {
    throw new Error(messages().inputText.birthdayFormat)
  }

  const year = parts[0] === null ? null : Number(parts[0])
  const month = Number(parts[1])
  const day = Number(parts[2])
  if (year !== null && year < 1000) throw new Error(messages().inputText.birthdayYear)
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(month, year)) {
    throw new Error(messages().inputText.birthdayReal)
  }
  return text
}

/** True when the birthday has no year ("--MM-DD"). */
export function birthdayHasYear(birthday: ContactBirthday): boolean {
  return FULL_DATE.test(birthday)
}

/** Trims an interaction's text; throws if empty or too long. */
export function normalizeInteractionText(value: unknown): string {
  if (typeof value !== 'string') throw new Error(messages().inputText.interactionTextType)
  const text = value.trim()
  if (text.length === 0) throw new Error(messages().inputText.describeInteraction)
  if (text.length > MAX_INTERACTION_TEXT_LENGTH) {
    throw new Error(messages().inputText.interactionTooLong(MAX_INTERACTION_TEXT_LENGTH))
  }
  return text
}

/** Checks an optional phone-contact identifier. */
export function normalizeExternalPhoneId(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_EXTERNAL_PHONE_ID_LENGTH) {
    throw new Error(messages().inputText.phoneIdInvalid)
  }
  return value
}
