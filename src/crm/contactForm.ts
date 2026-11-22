import { messages } from '../i18n'
import { localDateTimeToUtc, utcToLocalDateTime } from '../time/time'
import { combineDateAndTime, invalidDateTimeMessage, parseDateDMY, splitLocalDateTime } from '../logging/dateTimeInput'
import type { Contact, ContactBirthday } from '../database/types'
import type { CreateContactInput, UpdateContactInput } from '../database/contacts'

import { CONTACT_TEXT_FIELDS, normalizeBirthday } from './contactFields'

/**
 * Pure helpers for the Personal CRM screens (no React, no database):
 * search, the birthday field, the contact form and interaction times.
 */

// ---------------------------------------------------------------------------
// Search

/** Lower case without accents, so "emile" finds "Émile". */
export function foldForSearch(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
}

/**
 * Contacts matching every word of the query, in any text field (name,
 * description, education, address, interests, dislikes). Case and
 * accents are ignored; an empty query returns every contact. Order kept.
 */
export function filterContacts<T extends Contact>(contacts: readonly T[], query: string): T[] {
  const words = foldForSearch(query).split(/\s+/).filter(Boolean)
  if (words.length === 0) return [...contacts]
  return contacts.filter((contact) => {
    const haystack = foldForSearch([contact.name, ...CONTACT_TEXT_FIELDS.map((field) => contact[field] ?? '')].join('\n'))
    return words.every((word) => haystack.includes(word))
  })
}

// ---------------------------------------------------------------------------
// Birthday field: typed as dd/mm/yyyy, or dd/mm when the year is unknown.

const DAY_MONTH_INPUT = /^(\d{1,2})[/.-](\d{1,2})$/

/** The message for a birthday that cannot be read (current language). */
export function birthdayInputMessage(): string {
  return messages().inputText.birthdayInput
}

export type BirthdayInputResult = { ok: true; birthday: ContactBirthday | null } | { ok: false; message: string }

export function parseBirthdayInput(text: string): BirthdayInputResult {
  const trimmed = text.trim()
  if (trimmed === '') return { ok: true, birthday: null }

  let candidate: string | null = parseDateDMY(trimmed)
  if (candidate === null) {
    const dayMonth = DAY_MONTH_INPUT.exec(trimmed)
    if (dayMonth) candidate = `--${dayMonth[2].padStart(2, '0')}-${dayMonth[1].padStart(2, '0')}`
  }
  if (candidate === null) return { ok: false, message: birthdayInputMessage() }

  try {
    return { ok: true, birthday: normalizeBirthday(candidate) }
  } catch {
    return { ok: false, message: birthdayInputMessage() }
  }
}

/** "1990-05-17" → "17/05/1990"; "--05-17" → "17/05"; null → "". */
export function formatBirthdayInput(birthday: ContactBirthday | null): string {
  if (birthday === null) return ''
  if (birthday.startsWith('--')) return `${birthday.slice(5, 7)}/${birthday.slice(2, 4)}`
  return `${birthday.slice(8, 10)}/${birthday.slice(5, 7)}/${birthday.slice(0, 4)}`
}

// ---------------------------------------------------------------------------
// Contact form

/** What the form fields show (always text; birthday as dd/mm/yyyy or dd/mm). */
export interface ContactFormValues {
  name: string
  description: string
  education: string
  address: string
  birthday: string
  interests: string
  dislikes: string
}

export const EMPTY_CONTACT_FORM: ContactFormValues = {
  name: '', description: '', education: '', address: '', birthday: '', interests: '', dislikes: '',
}

export function formFromContact(contact: Contact): ContactFormValues {
  return {
    name: contact.name,
    description: contact.description ?? '',
    education: contact.education ?? '',
    address: contact.address ?? '',
    birthday: formatBirthdayInput(contact.birthday),
    interests: contact.interests ?? '',
    dislikes: contact.dislikes ?? '',
  }
}

/** True when any field differs from what the contact holds (as typed). */
export function isContactFormDirty(contact: Contact, form: ContactFormValues): boolean {
  const saved = formFromContact(contact)
  return (Object.keys(saved) as (keyof ContactFormValues)[]).some((field) => saved[field] !== form[field])
}

export type ContactChangesResult = { ok: true; changes: UpdateContactInput } | { ok: false; message: string }

/**
 * Only the fields whose meaning changed (trimmed text, empty = none,
 * birthday as stored), so saving never rewrites a field the user did not
 * change. Name rules are checked when saving.
 */
export function contactChanges(contact: Contact, form: ContactFormValues): ContactChangesResult {
  const birthday = parseBirthdayInput(form.birthday)
  if (!birthday.ok) return birthday

  const changes: UpdateContactInput = {}
  if (form.name.trim() !== contact.name) changes.name = form.name
  if (birthday.birthday !== contact.birthday) changes.birthday = birthday.birthday
  for (const field of CONTACT_TEXT_FIELDS) {
    if ((form[field].trim() || null) !== contact[field]) changes[field] = form[field]
  }
  return { ok: true, changes }
}

export type NewContactResult = { ok: true; input: CreateContactInput } | { ok: false; message: string }

export function newContactInput(form: ContactFormValues): NewContactResult {
  const birthday = parseBirthdayInput(form.birthday)
  if (!birthday.ok) return birthday
  return {
    ok: true,
    input: {
      name: form.name,
      description: form.description,
      education: form.education,
      address: form.address,
      birthday: birthday.birthday,
      interests: form.interests,
      dislikes: form.dislikes,
    },
  }
}

// ---------------------------------------------------------------------------
// Interaction time

/** The date (dd/mm/yyyy) and time (HH:mm) fields for an instant in a timezone. */
export function fieldsFromInstant(utc: string, timezone: string): { date: string; time: string } {
  return splitLocalDateTime(utcToLocalDateTime(utc, timezone))
}

export type InteractionTimeResult =
  | { ok: true; occurredStart: string; ambiguous: boolean }
  | { ok: false; message: string }

/**
 * The UTC instant for a typed local date and time in a timezone.
 * A time skipped by a daylight-saving change is refused; a time that
 * occurs twice uses the first occurrence and is flagged.
 */
export function interactionTimeFromFields(dateText: string, timeText: string, timezone: string): InteractionTimeResult {
  const local = combineDateAndTime(dateText, timeText)
  if (local === null) return { ok: false, message: invalidDateTimeMessage() }
  try {
    const { utc, ambiguous } = localDateTimeToUtc(local, timezone)
    return { ok: true, occurredStart: utc, ambiguous }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : invalidDateTimeMessage() }
  }
}

/** The note shown when a time occurs twice (current language). */
export function ambiguousTimeNote(): string {
  return messages().inputText.ambiguousTime
}
