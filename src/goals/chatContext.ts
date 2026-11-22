import { messages } from '../i18n'
import type { ChatMessage } from '../ai/ollama'
import { buildSummaryFacts } from '../ai/summaryFacts'
import type { Measure } from '../analysis/measures'
import { addDays } from '../stats/subjects'
import { formatInTimezone } from '../time/time'

import { allTimeText, baselineText, describeSuccess, formatProgressValue, progressStatusText } from './goalFormat'
import { baselineShare, goalProgress } from './goals'
import type { Goal, GoalsProfile } from './goals'

/**
 * What the local AI receives in the Goals chat (docs/GOALS_PLAN.md step 2).
 * Pure. Built by the app from the profile (the person's own texts), the
 * goals with the app's progress figures, and the same 30-day summary
 * sentences as the Dashboard's AI summary — summaries only, never records.
 *
 * Kept small on purpose (measured 2026-11-13: ~3,700 tokens of context
 * took 217 s for a first reply on this computer): the profile texts share
 * a fixed character budget, at most 8 current goals and 3 finished ones
 * are described, and only the most recent messages that fit are sent.
 */

/** Context size asked from Ollama, in tokens. */
export const CHAT_NUM_CTX = 4096
/** Tokens kept free for the reply. */
export const REPLY_RESERVE = 700
/** Characters for all "about you" texts together (style and format apart). */
export const PROFILE_BUDGET = 2400
export const STYLE_BUDGET = 300
export const MAX_CURRENT_GOALS = 8
export const MAX_FINISHED_GOALS = 3
export const CHAT_DAYS = 30


/** Rough token count (English is ~4 characters per token; 3.5 errs on the safe side). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5)
}

function cut(text: string, allowed: number): string {
  if (allowed <= 1) return '…'
  let part = text.slice(0, allowed - 1)
  const space = part.lastIndexOf(' ')
  if (space > allowed * 0.8) part = part.slice(0, space)
  return `${part.trimEnd()}…`
}

/**
 * Shortens texts to fit `budget` characters in total, fairly: short texts
 * are kept whole and the rest is shared equally among the longer ones
 * (e.g. lengths 10, 100, 100 with budget 110 → 10, 50, 50). Shortened
 * texts end with "…" (within their share).
 */
export function shortenToBudget(texts: readonly string[], budget: number): string[] {
  const allowed = texts.map(() => 0)
  let remaining = budget
  const order = texts.map((_, index) => index).sort((a, b) => texts[a].length - texts[b].length)
  order.forEach((index, position) => {
    const share = Math.floor(remaining / (order.length - position))
    allowed[index] = Math.min(texts[index].length, share)
    remaining -= allowed[index]
  })
  return texts.map((text, index) => (text.length <= allowed[index] ? text : cut(text, allowed[index])))
}

export interface ChatContextSection {
  title: string
  lines: string[]
}

export interface ChatContext {
  /** The system message sent to the model. */
  system: string
  /** The same content, for "What the AI receives". */
  sections: ChatContextSection[]
  /** Whether some of the person's texts were shortened. */
  shortened: boolean
}

function dmy(date: string): string {
  return date.split('-').reverse().join('/')
}

function goalPeriod(goal: Goal): { start: string; end: string } {
  return { start: formatInTimezone(goal.startUtc, goal.timezone, 'yyyy-MM-dd'), end: formatInTimezone(goal.endUtc, goal.timezone, 'yyyy-MM-dd') }
}

/** One goal with the app's figures, as the AI receives it (chat and opinion). */
export function goalLine(goal: Goal, measures: readonly Measure[], today: string): string {
  const period = goalPeriod(goal)
  const success = measures.find((measure) => measure.id === goal.success.measure)
  const t = messages().ai.goal
  const head = t.head(goal.title, t.kinds[goal.kind], dmy(period.start), dmy(period.end))
  if (!success) return `${head}${t.measureGone(goal.ambition, goal.realism)}`
  const progress = goalProgress(goal, period, success.daily, today)
  const when = progress.status === 'in-progress' ? t.inProgress(progress.daysElapsed, progress.daysTotal) : progress.status === 'not-started' ? t.notStarted : t.finished
  const parts = [`${head}${t.when(when)}`, t.success(describeSuccess(goal, success))]
  if (progress.value !== null) {
    parts.push(t.soFar(formatProgressValue(goal, success, progress.value), progressStatusText(progress).toLowerCase(), progress.daysWithData))
    if (progress.projected !== null && progress.status === 'in-progress') parts.push(t.atThisPace(formatProgressValue(goal, success, progress.projected)))
  } else if (progress.status !== 'not-started') {
    parts.push(t.noData)
  }
  parts.push(baselineText(goal, success, baselineShare(goal, period, success.daily)))
  // Older data too (the card's figure covers 90 days), when there is any.
  const allTime = baselineShare(goal, period, success.daily, null)
  if (allTime && allTime.first < addDays(period.start, -90)) parts.push(allTimeText(goal, success, allTime))
  parts.push(t.ratings(goal.ambition, goal.realism))
  return parts.join(' ')
}

/** Current goals (in progress, then not started; by finish) and the most recently finished ones. */
export function chosenGoals(goals: readonly Goal[], today: string): { current: Goal[]; finished: Goal[] } {
  const withPeriod = goals.map((goal) => ({ goal, period: goalPeriod(goal) }))
  const current = withPeriod
    .filter(({ period }) => period.end >= today)
    .sort((a, b) => Number(a.period.start > today) - Number(b.period.start > today) || a.goal.endUtc.localeCompare(b.goal.endUtc))
    .slice(0, MAX_CURRENT_GOALS)
    .map(({ goal }) => goal)
  const finished = withPeriod
    .filter(({ period }) => period.end < today)
    .sort((a, b) => b.goal.endUtc.localeCompare(a.goal.endUtc))
    .slice(0, MAX_FINISHED_GOALS)
    .map(({ goal }) => goal)
  return { current, finished }
}

export function buildChatContext(input: { profile: GoalsProfile; goals: readonly Goal[]; measures: readonly Measure[]; today: string }): ChatContext {
  const { profile, goals, measures, today } = input
  const t = messages().ai.chat

  // About the person: their own texts, sharing one budget.
  const labelled: [string, string][] = [
    ...profile.epochs.map((epoch): [string, string] => [t.past(epoch.title || t.untitled), epoch.text]),
    [t.strengths, profile.virtues],
    [t.weaknesses, profile.faults],
    [t.plan, profile.futurePlan],
  ].filter(([, text]) => text.trim() !== '') as [string, string][]
  const texts = labelled.map(([, text]) => text.replace(/\s+/g, ' ').trim())
  const shortTexts = shortenToBudget(texts, PROFILE_BUDGET)
  const [style, format] = shortenToBudget([profile.aiStyle.trim(), profile.aiFormat.trim()], STYLE_BUDGET * 2)
  const shortened = shortTexts.some((text, index) => text !== texts[index]) || style !== profile.aiStyle.trim() || format !== profile.aiFormat.trim()
  const about = labelled.length === 0 ? [t.nothingAbout] : labelled.map(([label], index) => `${label}: ${shortTexts[index]}`)

  const { current, finished } = chosenGoals(goals, today)
  const goalLines = [
    ...current.map((goal) => goalLine(goal, measures, today)),
    ...finished.map((goal) => t.finished(goalLine(goal, measures, today))),
  ]
  const hidden = goals.length - current.length - finished.length
  if (hidden > 0) goalLines.push(t.hidden(hidden))
  if (goalLines.length === 0) goalLines.push(t.noGoals)

  const { facts } = buildSummaryFacts(measures, { start: addDays(today, -(CHAT_DAYS - 1)), end: today })

  const rules = t.rules(style || t.defaultStyle, format || t.defaultFormat)

  const sections: ChatContextSection[] = [
    { title: t.instructionsTitle, lines: [rules, t.today(dmy(today))] },
    { title: t.aboutTitle, lines: about },
    { title: t.goalsTitle, lines: goalLines },
    { title: t.statsTitle(CHAT_DAYS), lines: facts.length > 1 ? facts : [...facts, t.notEnough] },
  ]
  const system = sections
    .map((section, index) => (index === 0 ? section.lines.join('\n') : `${section.title}:\n${section.lines.map((line) => `- ${line}`).join('\n')}`))
    .join('\n\n')
  return { system, sections, shortened }
}

/**
 * The most recent messages that fit next to the context (always at least
 * the newest one; the kept part starts with one of the person's messages).
 */
export function fitConversation<T extends Pick<ChatMessage, 'role' | 'content'>>(messages: readonly T[], system: string): { kept: T[]; dropped: number } {
  const budget = Math.max(300, CHAT_NUM_CTX - estimateTokens(system) - REPLY_RESERVE)
  let used = 0
  let first = messages.length
  while (first > 0) {
    const cost = estimateTokens(messages[first - 1].content) + 4
    if (first < messages.length && used + cost > budget) break
    used += cost
    first -= 1
  }
  while (first < messages.length - 1 && messages[first].role !== 'user') first += 1
  return { kept: messages.slice(first), dropped: first }
}
