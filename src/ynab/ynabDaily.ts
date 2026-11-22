import type { ExternalSample } from '../database/types'
import { addDays } from '../stats/subjects'
import type { Observation } from '../stats/subjects'

import { YNAB_MEASUREMENT } from './ynabRecord'
import type { YnabMetadata } from './ynabImport'

/**
 * Spending per day for the Dashboard (docs/YNAB_PLAN.md).
 *
 * Conventions (documented choice):
 * - Spending = money OUT (negative amounts), shown as a positive number.
 *   Income and transfers between the user's own accounts are not spending.
 *   Split transactions count their parts (transfer parts excluded).
 * - YNAB records every transaction, so a day without spending counts as 0
 *   — from the first imported transaction up to `today` (not before).
 */

function outflowOf(metadata: YnabMetadata): number {
  if (metadata.subtransactions.length > 0) {
    return metadata.subtransactions
      .filter((sub) => !sub.transfer && sub.amountMilliunits < 0)
      .reduce((total, sub) => total - sub.amountMilliunits, 0)
  }
  return !metadata.transfer && metadata.amountMilliunits < 0 ? -metadata.amountMilliunits : 0
}

export interface SpendingSummary {
  /** Currency units per day (0 on days without spending). */
  daily: Observation[]
  currency: string | null
  /** Spending per category in the given dates, most first. */
  byCategory: { name: string; amount: number }[]
}

export function spendingSummary(samples: readonly ExternalSample[], today: string, range?: { start: string; end: string }): SpendingSummary {
  const transactions = samples.filter((sample) => sample.deletedAt === null && sample.measurementType === YNAB_MEASUREMENT)
  if (transactions.length === 0) return { daily: [], currency: null, byCategory: [] }
  const perDay = new Map<string, number>()
  const categories = new Map<string, number>()
  for (const sample of transactions) {
    const metadata = sample.metadata as unknown as YnabMetadata
    const milli = outflowOf(metadata)
    perDay.set(metadata.localDate, (perDay.get(metadata.localDate) ?? 0) + milli)
    if (range && (metadata.localDate < range.start || metadata.localDate > range.end)) continue
    const parts = metadata.subtransactions.length > 0
      ? metadata.subtransactions.filter((sub) => !sub.transfer && sub.amountMilliunits < 0).map((sub) => [sub.categoryName, -sub.amountMilliunits] as const)
      : milli > 0 ? [[metadata.categoryName, milli] as const] : []
    for (const [name, amount] of parts) categories.set(name ?? 'Uncategorised', (categories.get(name ?? 'Uncategorised') ?? 0) + amount)
  }
  const first = [...perDay.keys()].sort()[0]
  const daily: Observation[] = []
  for (let date = first; date <= today; date = addDays(date, 1)) {
    daily.push({ date, value: (perDay.get(date) ?? 0) / 1000 })
  }
  return {
    daily,
    currency: transactions[0].unit,
    byCategory: [...categories.entries()].map(([name, amount]) => ({ name, amount: amount / 1000 })).sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name)),
  }
}

export const OTHER_CATEGORY = 'Other'

export interface CategorySeries {
  /** Category names in colour order; the last one may be "Other". */
  categories: string[]
  /** Spending per day per category (0 on days without spending in it), same days as spendingSummary. */
  series: { key: string; daily: Observation[] }[]
}

/**
 * Spending split by category for a stacked chart. Categories are ordered
 * by their total over ALL imported transactions (not the shown dates), so
 * a category keeps its colour when the dates change. At most `slots`
 * colours: the rest is grouped as "Other".
 */
export function spendingByCategory(samples: readonly ExternalSample[], today: string, slots = 8): CategorySeries {
  const transactions = samples.filter((sample) => sample.deletedAt === null && sample.measurementType === YNAB_MEASUREMENT)
  if (transactions.length === 0) return { categories: [], series: [] }

  const perDay = new Map<string, Map<string, number>>()
  const totals = new Map<string, number>()
  for (const sample of transactions) {
    const metadata = sample.metadata as unknown as YnabMetadata
    const parts = metadata.subtransactions.length > 0
      ? metadata.subtransactions.filter((sub) => !sub.transfer && sub.amountMilliunits < 0).map((sub) => [sub.categoryName, -sub.amountMilliunits] as const)
      : !metadata.transfer && metadata.amountMilliunits < 0 ? [[metadata.categoryName, -metadata.amountMilliunits] as const] : []
    const day = perDay.get(metadata.localDate) ?? new Map<string, number>()
    perDay.set(metadata.localDate, day)
    for (const [rawName, amount] of parts) {
      const name = rawName ?? 'Uncategorised'
      day.set(name, (day.get(name) ?? 0) + amount)
      totals.set(name, (totals.get(name) ?? 0) + amount)
    }
  }

  const ordered = [...totals.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name]) => name)
  const named = ordered.length > slots ? ordered.slice(0, slots - 1) : ordered
  const grouped = new Set(ordered.slice(named.length))
  const categories = grouped.size > 0 ? [...named, OTHER_CATEGORY] : named

  const first = [...perDay.keys()].sort()[0]
  const dates: string[] = []
  for (let date = first; date <= today; date = addDays(date, 1)) dates.push(date)
  const series = categories.map((key) => ({
    key,
    daily: dates.map((date) => {
      const day = perDay.get(date)
      let milli = 0
      if (day) {
        for (const [name, amount] of day) {
          if (key === OTHER_CATEGORY ? grouped.has(name) : name === key) milli += amount
        }
      }
      return { date, value: milli / 1000 }
    }),
  }))
  return { categories, series }
}

/**
 * Spending per day for exactly the given categories (the user's choice),
 * one series each, 0 on days without spending in it; same days as
 * spendingSummary. A category with no transactions gives zeros.
 */
export function spendingForCategories(samples: readonly ExternalSample[], today: string, names: readonly string[]): { key: string; daily: Observation[] }[] {
  const all = spendingByCategory(samples, today, Number.MAX_SAFE_INTEGER)
  const byKey = new Map(all.series.map((series) => [series.key, series.daily]))
  const dates = all.series[0]?.daily.map((observation) => observation.date) ?? []
  return names.map((key) => ({ key, daily: byKey.get(key) ?? dates.map((date) => ({ date, value: 0 })) }))
}

/** Day-by-day sum of several series with the same days. */
export function sumSeries(series: readonly { daily: readonly Observation[] }[]): Observation[] {
  const first = series[0]?.daily ?? []
  return first.map((observation, index) => ({
    date: observation.date,
    value: series.reduce((sum, item) => sum + (item.daily[index]?.value ?? 0), 0),
  }))
}
