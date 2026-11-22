import { getSettingValue, putSetting } from '../database/settings'

import { parseSlots } from './chosenSlots'
import type { ChosenSlots } from './chosenSlots'

/**
 * Spending categories chosen for the Dashboard's YNAB panel (2026-11-12),
 * stored as colour slots (src/settings/chosenSlots.ts). Empty = all
 * categories (biggest 7 + Other). A synchronised setting.
 */

export const DASHBOARD_YNAB_CATEGORIES_KEY = 'dashboard.ynabCategories'
export const MAX_CHOSEN_CATEGORIES = 8

export function parseChosenCategories(text: string): ChosenSlots | null {
  return parseSlots(text, MAX_CHOSEN_CATEGORIES)
}

export async function loadChosenCategories(): Promise<ChosenSlots> {
  const value = await getSettingValue(DASHBOARD_YNAB_CATEGORIES_KEY)
  return (value === null ? null : parseChosenCategories(value)) ?? []
}

export async function saveChosenCategories(slots: ChosenSlots): Promise<ChosenSlots> {
  const valid = parseChosenCategories(JSON.stringify(slots)) ?? []
  await putSetting(DASHBOARD_YNAB_CATEGORIES_KEY, JSON.stringify(valid))
  return valid
}
