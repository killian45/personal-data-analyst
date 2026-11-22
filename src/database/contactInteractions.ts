import { normalizeInteractionText } from '../crm/contactFields'
import { messages } from '../i18n'
import { getDeviceTimezone } from '../time/time'

import { db } from './db'
import { initialSyncFields, nextSyncFields } from './sync'
import type { Contact, ContactInteraction } from './types'
import { normalizeTimestamp, validateTimezone } from './validation'

/**
 * Logged interactions with Personal CRM contacts (schema version 9).
 *
 * Time: occurredStart is a UTC instant and timezone the IANA zone it was
 * logged in (like habit entries). It defaults to now, in this device's
 * timezone. Interactions can only be added to, changed on or restored for
 * a contact that is not deleted.
 */

export interface CreateInteractionInput {
  contactId: string
  text: string
  /** ISO date-time with a timezone or offset; defaults to now. */
  occurredStart?: string
  /** IANA timezone; defaults to this device's timezone. */
  timezone?: string
}

export interface UpdateInteractionInput {
  text?: string
  occurredStart?: string
  timezone?: string
}

async function getExistingContact(contactId: string): Promise<Contact> {
  const contact = await db.contacts.get(contactId)
  if (!contact || contact.deletedAt !== null) throw new Error(messages().dbText.contactNotFound)
  return contact
}

async function getExistingInteraction(id: string): Promise<ContactInteraction> {
  const interaction = await db.contactInteractions.get(id)
  if (!interaction || interaction.deletedAt !== null) throw new Error(messages().dbText.interactionNotFound)
  return interaction
}

export async function createInteraction(input: CreateInteractionInput): Promise<ContactInteraction> {
  const text = normalizeInteractionText(input.text)
  const occurredStart = normalizeTimestamp(input.occurredStart ?? new Date().toISOString())
  const timezone = validateTimezone(input.timezone ?? getDeviceTimezone())

  return db.transaction('rw', db.contacts, db.contactInteractions, async () => {
    const contact = await getExistingContact(input.contactId)
    const now = new Date().toISOString()
    const interaction: ContactInteraction = {
      id: crypto.randomUUID(),
      contactId: contact.id,
      occurredStart,
      timezone,
      text,
      ...initialSyncFields(),
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    }
    await db.contactInteractions.add(interaction)
    return interaction
  })
}

/**
 * Changes the given fields. If nothing really changes, nothing is written
 * and the revision stays the same.
 */
export async function updateInteraction(id: string, changes: UpdateInteractionInput): Promise<ContactInteraction> {
  const next: Partial<Pick<ContactInteraction, 'text' | 'occurredStart' | 'timezone'>> = {}
  if (changes.text !== undefined) next.text = normalizeInteractionText(changes.text)
  if (changes.occurredStart !== undefined) next.occurredStart = normalizeTimestamp(changes.occurredStart)
  if (changes.timezone !== undefined) next.timezone = validateTimezone(changes.timezone)

  return db.transaction('rw', db.contacts, db.contactInteractions, async () => {
    const existing = await getExistingInteraction(id)
    await getExistingContact(existing.contactId)
    const changed = (Object.keys(next) as (keyof typeof next)[]).filter((field) => next[field] !== existing[field])
    if (changed.length === 0) return existing

    const updated: ContactInteraction = {
      ...existing,
      ...Object.fromEntries(changed.map((field) => [field, next[field]])),
      ...nextSyncFields(existing),
      updatedAt: new Date().toISOString(),
    }
    await db.contactInteractions.put(updated)
    return updated
  })
}

/** Soft-deletes an interaction. */
export async function deleteInteraction(id: string): Promise<void> {
  await db.transaction('rw', db.contactInteractions, async () => {
    const existing = await getExistingInteraction(id)
    const now = new Date().toISOString()
    await db.contactInteractions.put({ ...existing, ...nextSyncFields(existing), deletedAt: now, updatedAt: now })
  })
}

/** Restores a soft-deleted interaction (its contact must not be deleted). */
export async function restoreInteraction(id: string): Promise<ContactInteraction> {
  return db.transaction('rw', db.contacts, db.contactInteractions, async () => {
    const existing = await db.contactInteractions.get(id)
    if (!existing) throw new Error(messages().dbText.interactionNotFound)
    if (existing.deletedAt === null) throw new Error(messages().dbText.interactionNotDeleted)
    await getExistingContact(existing.contactId)
    const restored: ContactInteraction = {
      ...existing,
      ...nextSyncFields(existing),
      deletedAt: null,
      updatedAt: new Date().toISOString(),
    }
    await db.contactInteractions.put(restored)
    return restored
  })
}

/**
 * A contact's interactions that are not deleted, in time order (newest
 * first; equal times by when they were logged, newest first).
 */
export async function getInteractionsByContact(contactId: string): Promise<ContactInteraction[]> {
  await getExistingContact(contactId)
  const interactions = await db.contactInteractions.where('contactId').equals(contactId).toArray()
  return interactions
    .filter((interaction) => interaction.deletedAt === null)
    .sort((a, b) => b.occurredStart.localeCompare(a.occurredStart) || b.createdAt.localeCompare(a.createdAt))
}
