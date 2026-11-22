import { messages } from '../i18n'
import { getSettingValue, putSetting } from '../database/settings'

import { FormulaError, measuresUsed, parseFormula } from './parser'

/**
 * Custom measures ("My formulas", Phase 6 step 4). Stored as a JSON list
 * in the synced setting "formulas" and validated on load, restore and
 * sync. A formula uses existing measures only, never another formula
 * (avoids loops; decided 2026-11-11).
 */

export const FORMULAS_KEY = 'formulas'
export const MAX_FORMULAS = 50
const MAX_NAME = 60
const MAX_UNIT = 20

export type FormulaDisplay = 'number' | 'duration'

export interface FormulaDefinition {
  id: string
  name: string
  unit: string | null
  /** "duration": the result is in hours and shown as h/min. */
  display: FormulaDisplay
  /** Stored form with {measure-id} references (see parser.ts). */
  expression: string
}

const ID_PATTERN = /^f_[a-z0-9]{6,40}$/

/** Checks one definition; throws an Error with a plain-language reason. */
export function validateFormulaDefinition(value: unknown): FormulaDefinition {
  const item = (value ?? {}) as Record<string, unknown>
  if (typeof item.id !== 'string' || !ID_PATTERN.test(item.id)) throw new Error('invalid formula id')
  const name = typeof item.name === 'string' ? item.name.trim() : ''
  if (name.length === 0 || name.length > MAX_NAME) throw new Error(messages().formulaText.nameLength(MAX_NAME))
  const unit = item.unit === null || item.unit === undefined ? null : typeof item.unit === 'string' ? item.unit.trim() || null : undefined
  if (unit === undefined || (unit !== null && unit.length > MAX_UNIT)) throw new Error(messages().formulaText.unitLength(MAX_UNIT))
  if (item.display !== 'number' && item.display !== 'duration') throw new Error('invalid formula display')
  if (typeof item.expression !== 'string') throw new Error('invalid formula expression')
  const used = measuresUsed(parseFormula(item.expression)) // throws FormulaError
  if (used.length === 0) throw new FormulaError(messages().formulaText.noMeasure)
  if (used.some((id) => id.startsWith('formula:'))) throw new FormulaError(messages().formulaText.noFormula)
  return { id: item.id, name, unit, display: item.display, expression: item.expression }
}

/** Parses the stored list; null if anything in it is invalid. */
export function parseFormulaList(text: string): FormulaDefinition[] | null {
  try {
    const value: unknown = JSON.parse(text)
    if (!Array.isArray(value) || value.length > MAX_FORMULAS) return null
    const list = value.map(validateFormulaDefinition)
    const ids = new Set(list.map((item) => item.id))
    const names = new Set(list.map((item) => item.name.toLowerCase()))
    return ids.size === list.length && names.size === list.length ? list : null
  } catch {
    return null
  }
}

export async function loadFormulas(): Promise<FormulaDefinition[]> {
  const value = await getSettingValue(FORMULAS_KEY)
  return (value === null ? null : parseFormulaList(value)) ?? []
}

export function newFormulaId(): string {
  return `f_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`
}

/** Adds or replaces (same id) a formula; checks the whole list first. */
export async function saveFormula(definition: FormulaDefinition): Promise<FormulaDefinition[]> {
  const clean = validateFormulaDefinition(definition)
  const current = await loadFormulas()
  const others = current.filter((item) => item.id !== clean.id)
  if (others.some((item) => item.name.toLowerCase() === clean.name.toLowerCase())) {
    throw new Error(messages().formulaText.nameTaken(clean.name))
  }
  const exists = others.length !== current.length
  if (!exists && current.length >= MAX_FORMULAS) throw new Error(messages().formulaText.tooMany(MAX_FORMULAS))
  const list = exists ? current.map((item) => (item.id === clean.id ? clean : item)) : [...current, clean]
  await putSetting(FORMULAS_KEY, JSON.stringify(list))
  return list
}

export async function deleteFormula(id: string): Promise<FormulaDefinition[]> {
  const list = (await loadFormulas()).filter((item) => item.id !== id)
  await putSetting(FORMULAS_KEY, JSON.stringify(list))
  return list
}
