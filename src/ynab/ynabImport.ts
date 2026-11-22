import { messages } from '../i18n'
import { db } from '../database/db'
import { stableStringify } from '../database/stableStringify'
import { initialSyncFields, nextSyncFields } from '../database/sync'
import type { ExternalSample } from '../database/types'
import { createAutoImporter } from '../screenTime/autoImport'
import { addDays } from '../stats/subjects'
import { formatInTimezone, getDeviceTimezone, getUtcOffsetMinutes, localDateTimeToUtc } from '../time/time'

import { getTransactions } from './ynabApi'
import type { YnabTransaction } from './ynabApi'
import { getYnabConnection, setYnabConnection } from './ynabConnection'
import type { YnabConnection } from './ynabConnection'

/**
 * YNAB transactions → imported samples (docs/YNAB_PLAN.md).
 *
 * - One record per transaction (`ynab_transaction`), value in currency
 *   units (amount / 1000; negative = money out), every YNAB field kept in
 *   metadata (including the exact milliunits and split parts).
 * - YNAB is the reference for money: a transaction changed in YNAB is
 *   updated here, one deleted in YNAB is deleted here (soft delete, so it
 *   stays in backups and can be seen in Deleted data). A transaction the
 *   user deleted in PDA is left deleted.
 */

export { YNAB_MEASUREMENT, validateYnabSample } from './ynabRecord'
import { YNAB_MEASUREMENT } from './ynabRecord'
/** First import: transactions from this many days back. */
export const YNAB_FIRST_DAYS = 365

export interface YnabMetadata {
  format: 1
  localDate: string
  budgetId: string
  amountMilliunits: number
  accountName: string | null
  payeeName: string | null
  categoryName: string | null
  memo: string | null
  cleared: string | null
  approved: boolean
  flagColor: string | null
  /** A transfer between the user's own accounts (not spending). */
  transfer: boolean
  subtransactions: { id: string; amountMilliunits: number; categoryName: string | null; payeeName: string | null; memo: string | null; transfer: boolean }[]
}

export interface YnabPlan {
  toAdd: ExternalSample[]
  toUpdate: ExternalSample[]
  toDelete: ExternalSample[]
  unchanged: number
  deletedInPda: number
  notImported: { label: string; reason: string }[]
  serverKnowledge: number
}

interface MapOptions { budgetId: string; currency: string | null; zone: string; importedAt: string; newId: () => string }

function startOfDay(date: string, zone: string): string {
  try {
    return localDateTimeToUtc(`${date}T00:00`, zone).utc
  } catch {
    // Midnight skipped by a clock change in that zone: use noon.
    return localDateTimeToUtc(`${date}T12:00`, zone).utc
  }
}

export function transactionSample(tx: YnabTransaction, options: MapOptions): ExternalSample {
  const startUtc = startOfDay(tx.date, options.zone)
  const metadata: YnabMetadata = {
    format: 1,
    localDate: tx.date,
    budgetId: options.budgetId,
    amountMilliunits: tx.amount,
    accountName: tx.accountName,
    payeeName: tx.payeeName,
    categoryName: tx.categoryName,
    memo: tx.memo,
    cleared: tx.cleared,
    approved: tx.approved,
    flagColor: tx.flagColor,
    transfer: tx.transferAccountId !== null,
    subtransactions: tx.subtransactions.filter((sub) => !sub.deleted).map((sub) => ({
      id: sub.id, amountMilliunits: sub.amount, categoryName: sub.categoryName, payeeName: sub.payeeName, memo: sub.memo, transfer: sub.transferAccountId !== null,
    })),
  }
  return {
    id: options.newId(),
    source: 'ynab',
    externalId: tx.id,
    sourceApp: 'YNAB',
    dedupeKey: `ynab:${options.budgetId}:${tx.id}`,
    measurementType: YNAB_MEASUREMENT,
    value: tx.amount / 1000,
    unit: options.currency,
    startUtc,
    endUtc: null,
    timezone: options.zone,
    startOffsetMinutes: getUtcOffsetMinutes(startUtc, options.zone),
    importedAt: options.importedAt,
    metadata: metadata as unknown as Record<string, unknown>,
    ...initialSyncFields(),
    createdAt: options.importedAt,
    updatedAt: options.importedAt,
    deletedAt: null,
  }
}

const CONTENT = (sample: ExternalSample) => stableStringify([sample.value, sample.unit, sample.startUtc, sample.metadata])

/** Pure: compares YNAB's answer with the stored transactions. */
export function planYnabImport(
  transactions: readonly YnabTransaction[],
  existing: readonly ExternalSample[],
  options: MapOptions,
  serverKnowledge: number,
  unreadable: readonly string[] = [],
): YnabPlan {
  const byKey = new Map(existing.map((sample) => [sample.dedupeKey, sample]))
  const plan: YnabPlan = {
    toAdd: [], toUpdate: [], toDelete: [], unchanged: 0, deletedInPda: 0, serverKnowledge,
    notImported: unreadable.map((id) => ({ label: messages().importText.ynab.transaction(id), reason: messages().importText.couldNotBeRead })),
  }
  for (const tx of transactions) {
    const stored = byKey.get(`ynab:${options.budgetId}:${tx.id}`)
    if (tx.deleted) {
      if (stored && stored.deletedAt === null) {
        plan.toDelete.push({ ...stored, ...nextSyncFields(stored), deletedAt: options.importedAt, updatedAt: options.importedAt })
      }
      continue
    }
    const sample = transactionSample(tx, options)
    if (!stored) plan.toAdd.push(sample)
    else if (stored.deletedAt !== null) plan.deletedInPda += 1
    else if (CONTENT(stored) === CONTENT(sample)) plan.unchanged += 1
    else {
      plan.toUpdate.push({
        ...stored, value: sample.value, unit: sample.unit, startUtc: sample.startUtc, timezone: sample.timezone,
        startOffsetMinutes: sample.startOffsetMinutes, metadata: sample.metadata, importedAt: options.importedAt,
        ...nextSyncFields(stored), updatedAt: options.importedAt,
      })
    }
  }
  return plan
}

export function changedYnabDates(plan: YnabPlan): string[] {
  return [...plan.toAdd, ...plan.toUpdate, ...plan.toDelete].map((sample) => String((sample.metadata as { localDate?: unknown }).localDate))
}

export interface YnabPreview extends YnabPlan {
  connection: YnabConnection
}

/** Asks YNAB for changes and plans the import. Writes nothing. */
export async function previewYnabImport(now = new Date(), fetchFn: typeof fetch = fetch): Promise<YnabPreview> {
  const connection = getYnabConnection()
  if (!connection) throw new Error(messages().importText.ynab.notConnected)
  const zone = getDeviceTimezone()
  const today = formatInTimezone(now.toISOString(), zone, 'yyyy-MM-dd')
  const answer = await getTransactions(connection.token, connection.budgetId, {
    lastKnowledge: connection.serverKnowledge,
    sinceDate: addDays(today, -YNAB_FIRST_DAYS),
  }, fetchFn)
  const existing = await db.externalSamples.where('measurementType').equals(YNAB_MEASUREMENT).toArray()
  const plan = planYnabImport(answer.transactions, existing, {
    budgetId: connection.budgetId, currency: connection.currency, zone, importedAt: now.toISOString(), newId: () => crypto.randomUUID(),
  }, answer.serverKnowledge, answer.unreadable)
  return { ...plan, connection }
}

/**
 * Saves the plan in one transaction (nothing if anything changed
 * meanwhile), then remembers YNAB's position for the next delta request.
 */
export async function applyYnabImport(preview: YnabPreview): Promise<number> {
  try {
    await db.transaction('rw', db.externalSamples, async () => {
      await db.externalSamples.bulkAdd(preview.toAdd)
      for (const changed of [...preview.toUpdate, ...preview.toDelete]) {
        const current = await db.externalSamples.get(changed.id)
        if (!current || current.revision !== changed.revision - 1 || current.deletedAt !== null) throw new Error(`changed meanwhile: ${changed.dedupeKey}`)
        await db.externalSamples.put(changed)
      }
    })
  } catch (error) {
    console.error('YNAB import failed:', error)
    throw new Error(messages().importText.changedDuringImport)
  }
  const current = getYnabConnection()
  if (current && current.budgetId === preview.connection.budgetId) setYnabConnection({ ...current, serverKnowledge: preview.serverKnowledge })
  return preview.toAdd.length + preview.toUpdate.length + preview.toDelete.length
}

/** Automatic YNAB import (same rules as the other automatic imports; on the device holding the token). */
export const ynabImporter = createAutoImporter<YnabPreview>('pda.ynabAutoImport', changedYnabDates, 'YNAB')
