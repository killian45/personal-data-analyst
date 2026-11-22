import { getSettingValue, putSetting } from '../database/settings'

/**
 * Order of the dashboard sections (user decision 2026-11-11: every section
 * can be re-arranged; default = PROJECT_SPEC.md §6.2 order).
 * Stored as a JSON list of section ids in the synced setting
 * "dashboard.order", e.g. ["bedtime", "habit:a", "sleepDuration", ...].
 * See src/dashboard/sectionOrder.ts for how it is applied.
 */

export const DASHBOARD_ORDER_KEY = 'dashboard.order'
const MAX_IDS = 1000

/** Parses a stored order; null if the text is not a valid list of ids. */
export function parseSectionOrder(text: string): string[] | null {
  try {
    const value: unknown = JSON.parse(text)
    if (
      !Array.isArray(value) ||
      value.length > MAX_IDS ||
      value.some((id) => typeof id !== 'string' || id.length === 0 || id.length > 200)
    ) {
      return null
    }
    return value as string[]
  } catch {
    return null
  }
}

/** The saved order, or null if the user never re-arranged the dashboard. */
export async function loadSectionOrder(): Promise<string[] | null> {
  const value = await getSettingValue(DASHBOARD_ORDER_KEY)
  return value === null ? null : parseSectionOrder(value)
}

export async function saveSectionOrder(order: readonly string[]): Promise<void> {
  await putSetting(DASHBOARD_ORDER_KEY, JSON.stringify(order))
}
