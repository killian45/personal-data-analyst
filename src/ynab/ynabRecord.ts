import type { ExternalSample } from '../database/types'

/** YNAB transaction records (docs/YNAB_PLAN.md); no heavy imports, used by restore and sync checks. */
export const YNAB_MEASUREMENT = 'ynab_transaction'

/** Throws if a stored YNAB transaction breaks the rules (backup restore and sync). */
export function validateYnabSample(sample: ExternalSample): void {
  if (sample.source !== 'ynab') throw new Error('YNAB transactions must have the source "ynab"')
  const metadata = (sample.metadata ?? {}) as Record<string, unknown>
  if (typeof metadata.localDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(metadata.localDate)) throw new Error('missing or invalid date')
  if (typeof metadata.budgetId !== 'string' || typeof sample.externalId !== 'string') throw new Error('missing YNAB identifiers')
  if (sample.dedupeKey !== `ynab:${metadata.budgetId}:${sample.externalId}`) throw new Error('invalid duplicate-detection key')
  if (typeof metadata.amountMilliunits !== 'number' || !Number.isInteger(metadata.amountMilliunits) || sample.value !== metadata.amountMilliunits / 1000) {
    throw new Error('the amount does not match YNAB\'s amount')
  }
}

