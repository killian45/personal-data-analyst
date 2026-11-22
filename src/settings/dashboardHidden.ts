import { getSettingValue, putSetting } from '../database/settings'

/**
 * Dashboard panels the user chose to hide (2026-11-12). A setting, so it
 * is synchronised between devices and included in backups, like the
 * panel order. Hiding never deletes anything: the panel's data and
 * choices stay, and "Show" brings it back as it was.
 *
 * Value: JSON array of section ids ("sleepDuration", "habit:<id>",
 * "screenTime", "location", "formula:<id>", "aiSummary"). Ids of panels
 * that no longer exist are ignored.
 */

export const DASHBOARD_HIDDEN_KEY = 'dashboard.hidden'
export const AI_SUMMARY_SECTION_ID = 'aiSummary'
const MAX_IDS = 1000

export function parseHiddenSections(text: string): string[] | null {
  try {
    const value: unknown = JSON.parse(text)
    if (
      !Array.isArray(value) ||
      value.length > MAX_IDS ||
      value.some((id) => typeof id !== 'string' || id.length === 0 || id.length > 200)
    ) {
      return null
    }
    return [...new Set(value as string[])]
  } catch {
    return null
  }
}

export async function loadHiddenSections(): Promise<string[]> {
  const value = await getSettingValue(DASHBOARD_HIDDEN_KEY)
  return (value === null ? null : parseHiddenSections(value)) ?? []
}

export async function saveHiddenSections(hidden: readonly string[]): Promise<string[]> {
  const unique = [...new Set(hidden)].sort()
  await putSetting(DASHBOARD_HIDDEN_KEY, JSON.stringify(unique))
  return unique
}
