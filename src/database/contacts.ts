import { messages } from '../i18n'
import {
  CONTACT_FIELD_LABELS,
  CONTACT_TEXT_FIELDS,
  normalizeBirthday,
  normalizeContactName,
  normalizeContactText,
  normalizeExternalPhoneId,
} from '../crm/contactFields'

import { db } from './db'
import { initialSyncFields, nextSyncFields } from './sync'
import type { Contact, ContactBirthday } from './types'

/**
 * Personal CRM contacts (schema version 9).
 *
 * Same rules as the other synchronised records: every local change marks
 * the contact "pending" and increases its revision (src/database/sync.ts);
 * deletion is a soft delete (deletedAt), so it can be undone and synced.
 * Deleting a contact does not touch its interactions: they are hidden
 * while the contact is deleted and reappear when it is restored (like a
 * habit's entries).
 */

/** The fields the user edits. */
export interface ContactDetails {
  name: string
  description: string | null
  education: string | null
  address: string | null
  birthday: ContactBirthday | null
  interests: string | null
  dislikes: string | null
}

export type CreateContactInput = Pick<ContactDetails, 'name'> &
  Partial<Omit<ContactDetails, 'name'>> & {
    /** Set only by the phone import. */
    externalPhoneId?: string | null
  }

export type UpdateContactInput = Partial<ContactDetails>

/** Validates and normalises the given detail fields (only those present). */
function normalizeDetails(input: Partial<ContactDetails>): Partial<ContactDetails> {
  const details: Partial<ContactDetails> = {}
  if (input.name !== undefined) details.name = normalizeContactName(input.name)
  if (input.birthday !== undefined) details.birthday = normalizeBirthday(input.birthday)
  for (const field of CONTACT_TEXT_FIELDS) {
    if (input[field] !== undefined) details[field] = normalizeContactText(input[field], CONTACT_FIELD_LABELS[field])
  }
  return details
}

async function getExistingContact(id: string): Promise<Contact> {
  const contact = await db.contacts.get(id)
  if (!contact || contact.deletedAt !== null) throw new Error(messages().dbText.contactNotFound)
  return contact
}

export async function createContact(input: CreateContactInput): Promise<Contact> {
  const details = normalizeDetails(input)
  const now = new Date().toISOString()
  const contact: Contact = {
    id: crypto.randomUUID(),
    name: normalizeContactName(input.name),
    description: details.description ?? null,
    education: details.education ?? null,
    address: details.address ?? null,
    birthday: details.birthday ?? null,
    interests: details.interests ?? null,
    dislikes: details.dislikes ?? null,
    externalPhoneId: normalizeExternalPhoneId(input.externalPhoneId),
    ...initialSyncFields(),
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  }
  await db.contacts.add(contact)
  return contact
}

/**
 * Changes the given fields. Only fields whose (normalised) value really
 * changes count: if nothing changes, nothing is written and the revision
 * stays the same.
 */
export async function updateContact(id: string, changes: UpdateContactInput): Promise<Contact> {
  const details = normalizeDetails(changes)
  return db.transaction('rw', db.contacts, async () => {
    const existing = await getExistingContact(id)
    const changed = (Object.keys(details) as (keyof ContactDetails)[]).filter((field) => details[field] !== existing[field])
    if (changed.length === 0) return existing

    const updated: Contact = {
      ...existing,
      ...Object.fromEntries(changed.map((field) => [field, details[field]])),
      ...nextSyncFields(existing),
      updatedAt: new Date().toISOString(),
    }
    await db.contacts.put(updated)
    return updated
  })
}

/** Soft-deletes a contact (its interactions are kept, hidden). */
export async function deleteContact(id: string): Promise<void> {
  await db.transaction('rw', db.contacts, async () => {
    const existing = await getExistingContact(id)
    const now = new Date().toISOString()
    await db.contacts.put({ ...existing, ...nextSyncFields(existing), deletedAt: now, updatedAt: now })
  })
}

/** Restores a soft-deleted contact; its interactions reappear with it. */
export async function restoreContact(id: string): Promise<Contact> {
  return db.transaction('rw', db.contacts, async () => {
    const existing = await db.contacts.get(id)
    if (!existing) throw new Error(messages().dbText.contactNotFound)
    if (existing.deletedAt === null) throw new Error(messages().dbText.contactNotDeleted)
    const restored: Contact = { ...existing, ...nextSyncFields(existing), deletedAt: null, updatedAt: new Date().toISOString() }
    await db.contacts.put(restored)
    return restored
  })
}

/** A contact that is not deleted, or undefined. */
export async function getContact(id: string): Promise<Contact | undefined> {
  const contact = await db.contacts.get(id)
  return contact && contact.deletedAt === null ? contact : undefined
}

/** All contacts that are not deleted, by name (case- and accent-insensitive). */
export async function getContacts(): Promise<Contact[]> {
  const contacts = await db.contacts.filter((contact) => contact.deletedAt === null).toArray()
  return contacts.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.id.localeCompare(b.id))
}

/** Soft-deleted contacts, most recently deleted first (for "Deleted data"). */
export async function getDeletedContacts(): Promise<Contact[]> {
  const contacts = await db.contacts.filter((contact) => contact.deletedAt !== null).toArray()
  return contacts.sort((a, b) => (b.deletedAt ?? '').localeCompare(a.deletedAt ?? ''))
}
