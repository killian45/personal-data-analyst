import { allMessages } from '../i18n'
/**
 * Checks on a locally written summary (Phase 6 step 5). Pure.
 * - numbersNotGiven: times, dates and numbers in the summary that do not
 *   appear in the facts it was given. Times (HH:mm) and dates (dd/mm/yyyy)
 *   are compared as whole items, so "11:48" is not excused by an "11" in a
 *   date; other numbers are compared as values ("05" = "5", signs
 *   ignored). Small models sometimes change numbers; the panel shows a
 *   warning when this finds any.
 * - tidySummary: removes an introduction line such as "Here is a summary:".
 */

const TIME = /\b(\d{1,2}):(\d{2})\b/g
const DATE = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g

interface Items {
  times: Set<string>
  dates: Set<string>
  numbers: Set<number>
  ordered: string[]
}

function items(text: string): Items {
  const times = new Set<string>()
  const dates = new Set<string>()
  const ordered: string[] = []
  let rest = text.replace(DATE, (_, d: string, m: string, y: string) => {
    const date = `${d.padStart(2, '0')}/${m.padStart(2, '0')}/${y}`
    dates.add(date)
    ordered.push(date)
    return ' '
  })
  rest = rest.replace(TIME, (_, h: string, min: string) => {
    const time = `${h.padStart(2, '0')}:${min}`
    times.add(time)
    ordered.push(time)
    return ' '
  })
  const numbers = new Set<number>()
  for (const match of rest.matchAll(/\d+(?:[.,]\d+)?/g)) {
    const value = Number(match[0].replace(',', '.'))
    numbers.add(value)
    ordered.push(String(value))
  }
  return { times, dates, numbers, ordered }
}

/** Items of the summary not found in the facts, in order of appearance, each once. */
export function numbersNotGiven(summary: string, facts: readonly string[]): string[] {
  const given = items(facts.join('\n'))
  const found = items(summary)
  const missing = found.ordered.filter((item) =>
    item.includes(':') ? !given.times.has(item) : item.includes('/') ? !given.dates.has(item) : !given.numbers.has(Number(item)),
  )
  return [...new Set(missing)]
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Removes an introduction line ("Here is a summary:", "Voici…") in any of the app's languages. */
export function tidySummary(text: string): string {
  const words = allMessages().flatMap((catalogue) => catalogue.ai.introWords).map(escapeRegExp)
  return text.replace(new RegExp(`^\\s*(${words.join('|')})(?![\\p{L}])[^\\n]*\\n+`, 'iu'), '').trim()
}
