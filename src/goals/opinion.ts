import { allMessages, messages } from '../i18n'
import { buildSummaryFacts } from '../ai/summaryFacts'
import type { Measure } from '../analysis/measures'
import { addDays } from '../stats/subjects'

import { CHAT_DAYS, goalLine, shortenToBudget } from './chatContext'
import type { Goal, GoalsProfile } from './goals'

/**
 * The local AI's opinion of how likely a goal is (docs/GOALS_PLAN.md
 * step 3), shown next to the app's own data figure. Pure, except the
 * storage helpers at the end (localStorage, this computer only: not
 * synchronised, not in backups, deleted by "Delete all data").
 */

export type Likelihood = 'high' | 'medium' | 'low'

/** Characters for strengths and weaknesses together. */
export const OPINION_PROFILE_BUDGET = 600
export const OPINION_NUM_CTX = 2048

function dmy(date: string): string {
  return date.split('-').reverse().join('/')
}

/** Lines the AI receives for one goal (all built by the app). */
export function buildOpinionFacts(input: { goal: Goal; measures: readonly Measure[]; profile: GoalsProfile; today: string }): string[] {
  const { goal, measures, profile, today } = input
  const t = messages().ai
  const facts = [t.chat.today(dmy(today)), t.opinion.goal(goalLine(goal, measures, today))]
  const ids = [...new Set([goal.success.measure, goal.progressMeasure])]
  const related = ids.map((id) => measures.find((measure) => measure.id === id)).filter((measure): measure is Measure => measure !== undefined)
  const summary = buildSummaryFacts(related, { start: addDays(today, -(CHAT_DAYS - 1)), end: today }).facts
  if (summary.length > 1) facts.push(t.opinion.statistics(CHAT_DAYS, summary.slice(1).join(' ')))
  const [virtues, faults] = shortenToBudget([profile.virtues, profile.faults].map((text) => text.replace(/\s+/g, ' ').trim()), OPINION_PROFILE_BUDGET)
  if (virtues) facts.push(t.opinion.strengths(virtues))
  if (faults) facts.push(t.opinion.weaknesses(faults))
  return facts
}

export function opinionInstructions(profile: GoalsProfile): string {
  const style = shortenToBudget([profile.aiStyle.replace(/\s+/g, ' ').trim()], 300)[0]
  return messages().ai.opinion.instructions(style)
}

/** The message with the facts. */
export function opinionPrompt(facts: readonly string[]): string {
  return messages().ai.opinion.prompt(facts.map((fact) => `- ${fact}`).join('\n'))
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Splits the reply into the likelihood (null if the first line does not
 * say it) and the explanation. The first line is recognised in every
 * language ("Likelihood: high", "Probabilité : élevée"…).
 */
export function parseOpinion(text: string): { likelihood: Likelihood | null; text: string } {
  const trimmed = text.trim()
  for (const { ai } of allMessages()) {
    const levels = Object.entries(ai.opinion.levels) as [Likelihood, string][]
    const pattern = new RegExp(
      `^[\\s*#_]*${escapeRegExp(ai.opinion.likelihoodWord)}[\\s*_]*:?[\\s*_]*(${levels.map(([, word]) => escapeRegExp(word)).join('|')})(?![\\p{L}])[^\\n]*\\n*`,
      'iu',
    )
    const match = pattern.exec(trimmed)
    if (!match) continue
    const level = levels.find(([, word]) => word.toLowerCase() === match[1].toLowerCase())
    if (level) return { likelihood: level[0], text: trimmed.slice(match[0].length).trim() }
  }
  return { likelihood: null, text: trimmed }
}

// ---------------------------------------------------------------------------
// Storage (this computer only)

export const GOAL_OPINIONS_KEY = 'pda.goalOpinions'

export interface StoredOpinion {
  likelihood: Likelihood | null
  text: string
  /** What the AI received. */
  facts: string[]
  model: string
  /** UTC ISO time. */
  at: string
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

function isOpinion(value: unknown): value is StoredOpinion {
  const opinion = value as StoredOpinion
  return typeof value === 'object' && value !== null &&
    (opinion.likelihood === null || opinion.likelihood === 'high' || opinion.likelihood === 'medium' || opinion.likelihood === 'low') &&
    typeof opinion.text === 'string' && opinion.text.length <= 10_000 &&
    Array.isArray(opinion.facts) && opinion.facts.every((fact) => typeof fact === 'string') &&
    typeof opinion.model === 'string' && typeof opinion.at === 'string' && ISO.test(opinion.at)
}

/** Stored opinions by goal id; anything unreadable is ignored (never throws). */
export function parseOpinions(text: string | null): Record<string, StoredOpinion> {
  if (text === null) return {}
  try {
    const value = JSON.parse(text) as { version?: unknown; opinions?: unknown }
    if (value?.version !== 1 || typeof value.opinions !== 'object' || value.opinions === null) return {}
    return Object.fromEntries(Object.entries(value.opinions as Record<string, unknown>).filter((entry): entry is [string, StoredOpinion] => isOpinion(entry[1])))
  } catch {
    return {}
  }
}

export function loadOpinions(): Record<string, StoredOpinion> {
  try {
    return parseOpinions(localStorage.getItem(GOAL_OPINIONS_KEY))
  } catch {
    return {}
  }
}

/** Saves (or with null removes) one goal's opinion; returns all opinions. */
export function saveOpinion(goalId: string, opinion: StoredOpinion | null): Record<string, StoredOpinion> {
  const opinions = loadOpinions()
  if (opinion === null) delete opinions[goalId]
  else opinions[goalId] = opinion
  localStorage.setItem(GOAL_OPINIONS_KEY, JSON.stringify({ version: 1, opinions }))
  return opinions
}

export function clearOpinions(): void {
  try {
    localStorage.removeItem(GOAL_OPINIONS_KEY)
  } catch {
    // Storage unavailable: nothing stored.
  }
}
