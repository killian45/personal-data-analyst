import { messages } from '../i18n'
import type { Observation } from '../stats/subjects'

import type { FormulaDefinition } from './formulas'
import { evaluateFormula, FormulaError, measuresUsed, parseFormula } from './parser'

/**
 * The editor's readable form and the daily values of a formula. Pure.
 *
 * - Editor text names measures in square brackets: "[Sleep duration] - [Screen time]".
 *   Stored text uses ids: "{sleep:duration} - {screenTime}" (renaming a
 *   habit keeps formulas working).
 * - Daily values: a day has a value only if every measure used has one
 *   that day (dates as in the Analysis page: sleep uses the night date);
 *   null results (division by zero) are left out.
 */

export interface MeasureRef {
  id: string
  label: string
}

/** Stored text → editor text ([label]); unknown ids are shown as [missing: id]. */
export function toEditorText(expression: string, measures: readonly MeasureRef[]): string {
  const labels = new Map(measures.map((measure) => [measure.id, measure.label]))
  return expression.replace(/\{([^}]*)\}/g, (_, id: string) => `[${labels.get(id) ?? messages().formulaText.missing(id)}]`)
}

/** Editor text → stored text; throws FormulaError for unknown or ambiguous names. */
export function fromEditorText(text: string, measures: readonly MeasureRef[]): string {
  if (/[{}]/.test(text)) throw new FormulaError(messages().formulaText.useBrackets)
  const stored = text.replace(/\[([^\]]*)\]/g, (_, raw: string) => {
    const name = raw.trim().toLowerCase()
    const matches = measures.filter((measure) => measure.label.toLowerCase() === name)
    if (matches.length === 0) throw new FormulaError(messages().formulaText.noSuchMeasure(raw.trim()))
    if (matches.length > 1) throw new FormulaError(messages().formulaText.severalMeasures(raw.trim()))
    return `{${matches[0].id}}`
  })
  if (/[[\]]/.test(stored)) throw new FormulaError(messages().formulaText.bracketOpen)
  return stored
}

export type FormulaSeries =
  | { status: 'ok'; daily: Observation[] }
  | { status: 'missing-measures'; missing: string[] }
  | { status: 'invalid'; reason: string }

/** Daily values of a formula from the available measures' daily values. */
export function formulaDaily(definition: FormulaDefinition, measures: readonly { id: string; daily: readonly Observation[] }[]): FormulaSeries {
  let tree
  try {
    tree = parseFormula(definition.expression)
  } catch (error) {
    return { status: 'invalid', reason: error instanceof Error ? error.message : 'invalid formula' }
  }
  const used = measuresUsed(tree)
  const byId = new Map(measures.map((measure) => [measure.id, measure]))
  const missing = used.filter((id) => !byId.has(id))
  if (missing.length > 0) return { status: 'missing-measures', missing }

  const valuesById = used.map((id) => {
    const map = new Map<string, number>()
    for (const o of (byId.get(id) as { daily: readonly Observation[] }).daily) {
      if (typeof o.value === 'number' && Number.isFinite(o.value)) map.set(o.date, o.value)
    }
    return [id, map] as const
  })
  const [first, ...rest] = valuesById
  const daily: Observation[] = []
  for (const date of [...first[1].keys()].sort()) {
    if (!rest.every(([, map]) => map.has(date))) continue
    const values = new Map(valuesById.map(([id, map]) => [id, map.get(date) as number]))
    const value = evaluateFormula(tree, values)
    if (value !== null) daily.push({ date, value })
  }
  return { status: 'ok', daily }
}
