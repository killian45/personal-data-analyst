import { getSettingValue, putSetting } from '../database/settings'

import { chosenNames, parseSlots, toggleSlot } from './chosenSlots'
import type { ChosenSlots } from './chosenSlots'

/**
 * Apps shown in the Dashboard's screen-time panel (2026-11-12). Empty =
 * total screen time. A synchronised setting (like the other Dashboard
 * choices). Apps are identified by their displayed name.
 */

export const DASHBOARD_SCREEN_TIME_APPS_KEY = 'dashboard.screenTimeApps'
export const MAX_CHOSEN_APPS = 8

/** Colour slots (src/settings/chosenSlots.ts); older name-only values still read. */
export type ChosenAppSlots = ChosenSlots

export function parseChosenApps(text: string): ChosenAppSlots | null {
  return parseSlots(text, MAX_CHOSEN_APPS)
}

export { chosenNames }

/** Adds an app in the first free slot, or removes it (its slot becomes free). Pure. */
export function toggleChosenApp(slots: ChosenAppSlots, name: string): ChosenAppSlots {
  return toggleSlot(slots, name, MAX_CHOSEN_APPS)
}

export async function loadChosenApps(): Promise<ChosenAppSlots> {
  const value = await getSettingValue(DASHBOARD_SCREEN_TIME_APPS_KEY)
  return (value === null ? null : parseChosenApps(value)) ?? []
}

export async function saveChosenApps(slots: ChosenAppSlots): Promise<ChosenAppSlots> {
  const valid = parseChosenApps(JSON.stringify(slots)) ?? []
  await putSetting(DASHBOARD_SCREEN_TIME_APPS_KEY, JSON.stringify(valid))
  return valid
}
