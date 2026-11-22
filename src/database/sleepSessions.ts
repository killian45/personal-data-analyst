import { getDeviceTimezone, offsetToZoneName } from '../time/time'
import { messages } from '../i18n'

import { db } from './db'
import { initialSyncFields, nextSyncFields } from './sync'
import type { DataSource, SleepSession } from './types'
import {
  normalizeComment,
  normalizeTimestamp,
  validateSleepTimes,
  validateTimezone,
} from './validation'

/**
 * Sleep session operations (original sessions only; merged nights are
 * calculated by the sleep engine and never stored).
 *
 * Rules:
 * - Manual sessions can be created, edited, deleted and restored.
 * - Imported sessions keep their original data: only the user's comment
 *   can be edited. They can be deleted (soft) and restored.
 * - Two non-deleted manual sessions cannot have the same bedtime and
 *   wake time (prevents accidental duplicates).
 */

export interface ManualSleepInput {
  /** ISO date-time with offset. */
  startUtc: string
  endUtc: string
  timezone?: string
  comment?: string | null
}

export interface SleepSessionChanges {
  startUtc?: string
  endUtc?: string
  timezone?: string
  comment?: string | null
}

/**
 * Deterministic duplicate-detection key (see SleepSession.dedupeKey).
 */
export function buildSleepDedupeKey(input: {
  source: DataSource
  id: string
  externalId: string | null
  startUtc: string
  endUtc: string
}): string {
  if (input.source === 'manual') {
    return `manual:${input.id}`
  }

  return input.externalId !== null
    ? `${input.source}:id:${input.externalId}`
    : `${input.source}:time:${input.startUtc}:${input.endUtc}`
}

/**
 * The timezone in which a session's local times are read: its IANA
 * timezone if known, otherwise the UTC offset reported at its start.
 */
export function sleepSessionZone(session: Pick<SleepSession, 'timezone' | 'startOffsetMinutes'>): string {
  if (session.timezone !== null) {
    return session.timezone
  }

  if (session.startOffsetMinutes !== null) {
    return offsetToZoneName(session.startOffsetMinutes)
  }

  return 'UTC'
}

async function assertNoManualDuplicate(
  startUtc: string,
  endUtc: string,
  exceptId?: string,
): Promise<void> {
  const sameStart = await db.sleepSessions.where('startUtc').equals(startUtc).toArray()

  const duplicate = sameStart.some(
    (session) =>
      session.id !== exceptId &&
      session.deletedAt === null &&
      session.source === 'manual' &&
      session.endUtc === endUtc,
  )

  if (duplicate) {
    throw new Error(messages().dbText.sleepDuplicate)
  }
}

async function getExistingSession(id: string): Promise<SleepSession> {
  const session = await db.sleepSessions.get(id)

  if (!session || session.deletedAt !== null) {
    throw new Error(messages().dbText.sleepNotFound)
  }

  return session
}

export async function createManualSleepSession(
  input: ManualSleepInput,
): Promise<SleepSession> {
  const startUtc = normalizeTimestamp(input.startUtc)
  const endUtc = normalizeTimestamp(input.endUtc)
  validateSleepTimes(startUtc, endUtc)

  const timezone = validateTimezone(input.timezone ?? getDeviceTimezone())
  const comment = normalizeComment(input.comment)

  return db.transaction('rw', db.sleepSessions, async () => {
    await assertNoManualDuplicate(startUtc, endUtc)

    const id = crypto.randomUUID()
    const now = new Date().toISOString()

    const session: SleepSession = {
      id,
      source: 'manual',
      externalId: null,
      sourceApp: null,
      dedupeKey: buildSleepDedupeKey({ source: 'manual', id, externalId: null, startUtc, endUtc }),
      startUtc,
      endUtc,
      timezone,
      startOffsetMinutes: null,
      endOffsetMinutes: null,
      stages: [],
      reportedSleepMs: null,
      comment,
      importedAt: null,
      metadata: null,
      ...initialSyncFields(),
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    }

    await db.sleepSessions.add(session)

    return session
  })
}

export async function updateSleepSession(
  id: string,
  changes: SleepSessionChanges,
): Promise<SleepSession> {
  return db.transaction('rw', db.sleepSessions, async () => {
    const existing = await getExistingSession(id)

    const timesOrZoneChanged =
      changes.startUtc !== undefined ||
      changes.endUtc !== undefined ||
      changes.timezone !== undefined

    if (existing.source !== 'manual' && timesOrZoneChanged) {
      throw new Error(
        messages().dbText.importedSleepTimes,
      )
    }

    const startUtc = changes.startUtc === undefined
      ? existing.startUtc
      : normalizeTimestamp(changes.startUtc)
    const endUtc = changes.endUtc === undefined
      ? existing.endUtc
      : normalizeTimestamp(changes.endUtc)

    validateSleepTimes(startUtc, endUtc)

    if (existing.source === 'manual') {
      await assertNoManualDuplicate(startUtc, endUtc, existing.id)
    }

    const updated: SleepSession = {
      ...existing,
      startUtc,
      endUtc,
      timezone: changes.timezone === undefined
        ? existing.timezone
        : validateTimezone(changes.timezone),
      comment: changes.comment === undefined
        ? existing.comment
        : normalizeComment(changes.comment),
      ...nextSyncFields(existing),
      updatedAt: new Date().toISOString(),
    }

    await db.sleepSessions.put(updated)

    return updated
  })
}

/** Soft-deletes a sleep session; it stays stored and can be restored. */
export async function deleteSleepSession(id: string): Promise<void> {
  await db.transaction('rw', db.sleepSessions, async () => {
    const existing = await getExistingSession(id)
    const now = new Date().toISOString()

    await db.sleepSessions.put({
      ...existing,
      ...nextSyncFields(existing),
      deletedAt: now,
      updatedAt: now,
    })
  })
}

/** Restores a soft-deleted sleep session. */
export async function restoreSleepSession(id: string): Promise<SleepSession> {
  return db.transaction('rw', db.sleepSessions, async () => {
    const existing = await db.sleepSessions.get(id)

    if (!existing) {
      throw new Error(messages().dbText.sleepNotFound)
    }

    if (existing.deletedAt === null) {
      throw new Error(messages().dbText.sleepNotDeleted)
    }

    if (existing.source === 'manual') {
      await assertNoManualDuplicate(existing.startUtc, existing.endUtc, existing.id)
    }

    const restored: SleepSession = {
      ...existing,
      ...nextSyncFields(existing),
      deletedAt: null,
      updatedAt: new Date().toISOString(),
    }

    await db.sleepSessions.put(restored)

    return restored
  })
}
