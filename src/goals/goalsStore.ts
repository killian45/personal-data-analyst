import { getSettingValue, putSetting } from '../database/settings'
import { messages } from '../i18n'

import { cleanProfile, EMPTY_PROFILE, GOALS_LIST_KEY, GOALS_PROFILE_KEY, parseGoals, parseProfile, validateGoal } from './goals'
import type { Goal, GoalsProfile } from './goals'

/** Profile and goals as synchronised settings (docs/GOALS_PLAN.md). */

export async function loadProfile(): Promise<GoalsProfile> {
  const value = await getSettingValue(GOALS_PROFILE_KEY)
  return (value === null ? null : parseProfile(value)) ?? EMPTY_PROFILE
}

export async function saveProfile(profile: GoalsProfile): Promise<GoalsProfile> {
  const clean = cleanProfile(profile)
  if (parseProfile(JSON.stringify(clean)) === null) throw new Error(messages().goalText.profileTooLong)
  await putSetting(GOALS_PROFILE_KEY, JSON.stringify(clean))
  return clean
}

export async function loadGoals(): Promise<Goal[]> {
  const value = await getSettingValue(GOALS_LIST_KEY)
  return (value === null ? null : parseGoals(value)) ?? []
}

/** Adds or replaces one goal (checked first), keeping the others. */
export async function saveGoal(goal: Goal): Promise<Goal[]> {
  validateGoal(goal)
  const goals = await loadGoals()
  const next = goals.some((item) => item.id === goal.id) ? goals.map((item) => (item.id === goal.id ? goal : item)) : [...goals, goal]
  await putSetting(GOALS_LIST_KEY, JSON.stringify(next))
  return next
}

export async function deleteGoal(id: string): Promise<Goal[]> {
  const next = (await loadGoals()).filter((goal) => goal.id !== id)
  await putSetting(GOALS_LIST_KEY, JSON.stringify(next))
  return next
}
