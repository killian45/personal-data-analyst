import { formatNumber, messages } from '../i18n'
import { createContact } from '../database/contacts'
import type { CreateContactInput } from '../database/contacts'
import { db } from '../database/db'
import type { Contact, ContactBirthday } from '../database/types'

import {
  MAX_CONTACT_TEXT_LENGTH,
  normalizeBirthday,
  normalizeContactName,
  normalizeContactText,
  normalizeExternalPhoneId,
} from './contactFields'
import { foldForSearch, formatBirthdayInput } from './contactForm'

/**
 * Import of the phone's contacts into the Personal CRM (CRM step 3).
 *
 * Rules (approved 2026-11-12):
 * - The phone is only read. Name, postal addresses (each with its label),
 *   birthday and notes (→ Description) are imported; phone numbers and
 *   e-mail addresses are not.
 * - Duplicates: Android's lookup key is stored as externalPhoneId.
 *   Already imported → skipped; deleted in PDA → listed (restore it from
 *   Deleted data); changed on the phone since → PDA's version kept, the
 *   differing fields listed.
 * - Nothing is chosen by default: the user ticks the contacts to import.
 *   A contact with the same name as one already in PDA is flagged.
 * - Nothing is silently dropped or changed: a birthday that cannot be
 *   read, or a field over the length limit, is left out and listed.
 * - Saving is one transaction; if a chosen contact was imported
 *   meanwhile, nothing is saved.
 */

export interface PhoneAddress {
  formatted: string
  /** Android StructuredPostal type: 1 home, 2 work, 3 other, 0 custom. */
  type: number
  label: string | null
}

export interface PhoneContact {
  lookupKey: string
  name: string | null
  addresses: PhoneAddress[]
  /** Raw birthday texts as stored on the phone. */
  birthdays: string[]
  notes: string[]
}

export interface ImportIssueItem {
  name: string
  reason: string
}

export interface PhoneImportCandidate {
  key: string
  input: CreateContactInput
  /** A contact with the same name already exists in PDA (not imported from the phone). */
  sameNameAsExisting: boolean
  /** Parts left out, with the reason. */
  notes: string[]
}

export interface PhoneContactPlan {
  found: number
  candidates: PhoneImportCandidate[]
  alreadyImported: ImportIssueItem[]
  changedOnPhone: ImportIssueItem[]
  deletedInPda: ImportIssueItem[]
  notImportable: ImportIssueItem[]
}

// ---------------------------------------------------------------------------
// Reading the plugin's answer (a data boundary: checked, never trusted)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

/** Turns the plugin's raw list into PhoneContacts; entries without a lookup key are ignored. */
export function readPhoneContactList(raw: readonly unknown[]): PhoneContact[] {
  const contacts: PhoneContact[] = []
  for (const item of raw) {
    if (!isRecord(item) || typeof item.lookupKey !== 'string' || item.lookupKey === '') continue
    const addresses = Array.isArray(item.addresses)
      ? item.addresses.flatMap((address): PhoneAddress[] =>
          isRecord(address) && typeof address.formatted === 'string'
            ? [{
                formatted: address.formatted,
                type: typeof address.type === 'number' ? address.type : 0,
                label: typeof address.label === 'string' ? address.label : null,
              }]
            : [])
      : []
    contacts.push({
      lookupKey: item.lookupKey,
      name: typeof item.name === 'string' ? item.name : null,
      addresses,
      birthdays: strings(item.birthdays),
      notes: strings(item.notes),
    })
  }
  return contacts
}

// ---------------------------------------------------------------------------
// Field mapping

const FULL = /^(\d{4})-(\d{2})-(\d{2})$/
const COMPACT = /^(\d{4})(\d{2})(\d{2})$/
const WITH_TIME = /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/
const NO_YEAR = /^--(\d{2})-?(\d{2})$/
const DOTTED = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/

/**
 * Reads a birthday as phones store it: "1990-05-17", "--05-17" or
 * "--0517" (no year), "19900517", "1990-05-17T00:00:00Z" (date part kept)
 * and "17.05.1990". Slashed dates ("05/06/1990") are refused: day and
 * month order cannot be known. Returns null if not understood.
 */
export function parsePhoneBirthday(raw: string): ContactBirthday | null {
  const text = raw.trim()
  let candidate: string | null = null
  let match: RegExpExecArray | null
  if (FULL.test(text)) candidate = text
  else if ((match = COMPACT.exec(text))) candidate = `${match[1]}-${match[2]}-${match[3]}`
  else if ((match = WITH_TIME.exec(text))) candidate = match[1]
  else if ((match = NO_YEAR.exec(text))) candidate = `--${match[1]}-${match[2]}`
  else if ((match = DOTTED.exec(text))) candidate = `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`
  if (candidate === null) return null
  try {
    return normalizeBirthday(candidate)
  } catch {
    return null
  }
}

const ADDRESS_TYPES: Record<number, string> = { 1: 'Home', 2: 'Work', 3: 'Other' }

/** All addresses; with more than one, each starts with its label ("Home: …"). */
export function formatPhoneAddresses(addresses: readonly PhoneAddress[]): string | null {
  const usable = addresses.map((address) => ({ ...address, formatted: address.formatted.trim() })).filter((address) => address.formatted !== '')
  if (usable.length === 0) return null
  if (usable.length === 1) return usable[0].formatted
  return usable
    .map((address) => {
      const label = address.type === 0 ? address.label?.trim() || 'Address' : ADDRESS_TYPES[address.type] ?? 'Address'
      return `${label}: ${address.formatted}`
    })
    .join('\n\n')
}

/** The contact fields from a phone contact; parts that cannot be used are listed in notes. */
export function mapPhoneContact(phone: PhoneContact): { input: CreateContactInput; notes: string[] } {
  const notes: string[] = []
  const input: CreateContactInput = {
    name: normalizeContactName(phone.name ?? ''),
    externalPhoneId: normalizeExternalPhoneId(phone.lookupKey),
  }

  const optional = (field: 'address' | 'description', text: string | null, label: string) => {
    if (text === null) return
    if (text.trim().length > MAX_CONTACT_TEXT_LENGTH) {
      notes.push(messages().importText.contacts.tooLong(label, formatNumber(MAX_CONTACT_TEXT_LENGTH)))
      return
    }
    input[field] = normalizeContactText(text, label)
  }
  optional('address', formatPhoneAddresses(phone.addresses), messages().importText.contacts.address)
  const noteText = phone.notes.map((note) => note.trim()).filter(Boolean).join('\n\n')
  optional('description', noteText || null, messages().importText.contacts.note)

  for (const raw of phone.birthdays) {
    const birthday = parsePhoneBirthday(raw)
    if (birthday !== null) {
      input.birthday ??= birthday
    } else {
      notes.push(messages().importText.contacts.birthdayUnreadable(raw.trim()))
    }
  }
  return { input, notes }
}

/** Fields compared with the phone (their names: messages().importText.contacts.fields). */
const COMPARED = ['name', 'address', 'birthday', 'description'] as const

// ---------------------------------------------------------------------------
// Planning (pure)

export function planPhoneContactImport(phone: readonly PhoneContact[], existing: readonly Contact[]): PhoneContactPlan {
  const plan: PhoneContactPlan = { found: 0, candidates: [], alreadyImported: [], changedOnPhone: [], deletedInPda: [], notImportable: [] }
  const byKey = new Map(existing.filter((contact) => contact.externalPhoneId !== null).map((contact) => [contact.externalPhoneId as string, contact]))
  const names = new Set(existing.filter((contact) => contact.deletedAt === null).map((contact) => foldForSearch(contact.name)))
  const seen = new Set<string>()

  for (const contact of phone) {
    if (seen.has(contact.lookupKey)) continue
    seen.add(contact.lookupKey)
    plan.found += 1
    const name = contact.name?.trim() || '(no name)'

    let mapped: ReturnType<typeof mapPhoneContact>
    try {
      mapped = mapPhoneContact(contact)
    } catch (error) {
      plan.notImportable.push({ name, reason: error instanceof Error ? error.message : messages().importText.contacts.cannotBeRead })
      continue
    }

    const stored = byKey.get(contact.lookupKey)
    if (stored) {
      if (stored.deletedAt !== null) {
        plan.deletedInPda.push({ name, reason: messages().importText.contacts.deletedInPda })
        continue
      }
      const differing = COMPARED.filter((field) => (mapped.input[field] ?? null) !== stored[field]).map((field) => messages().importText.contacts.fields[field])
      if (differing.length > 0) {
        plan.changedOnPhone.push({ name, reason: messages().importText.contacts.differs(differing.join(', ')) })
      } else {
        plan.alreadyImported.push({ name, reason: messages().importText.contacts.alreadyImported })
      }
      continue
    }

    plan.candidates.push({
      key: contact.lookupKey,
      input: mapped.input,
      sameNameAsExisting: names.has(foldForSearch(mapped.input.name)),
      notes: mapped.notes,
    })
  }
  return plan
}

/** One line describing a candidate in the preview list. */
export function candidateSummary(candidate: PhoneImportCandidate): string {
  const parts: string[] = []
  if (candidate.input.birthday) parts.push(`Birthday ${formatBirthdayInput(candidate.input.birthday)}`)
  if (candidate.input.address) parts.push(candidate.input.address.split('\n')[0])
  if (candidate.input.description) parts.push('note')
  return parts.join(' · ')
}

/** Reads the phone and plans the import. Writes nothing. */
export async function previewPhoneContactImport(): Promise<PhoneContactPlan> {
  const { readPhoneContacts } = await import('./phoneContactsPlugin')
  const [phone, existing] = await Promise.all([readPhoneContacts(), db.contacts.toArray()])
  return planPhoneContactImport(phone, existing)
}

/**
 * Saves the chosen contacts in one transaction. If one of them was
 * imported meanwhile (another tab, a second run), nothing is saved.
 */
export async function applyPhoneContactImport(chosen: readonly PhoneImportCandidate[]): Promise<number> {
  try {
    await db.transaction('rw', db.contacts, async () => {
      for (const candidate of chosen) {
        const key = candidate.input.externalPhoneId
        if (!key || (await db.contacts.where('externalPhoneId').equals(key).count()) > 0) {
          throw new Error(`already imported: ${candidate.input.name}`)
        }
        await createContact(candidate.input)
      }
    })
  } catch (error) {
    console.error('Contact import failed:', error)
    throw new Error(messages().importText.contacts.nothingImported)
  }
  return chosen.length
}
