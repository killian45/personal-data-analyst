import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { db } from '../database/db'

import { formulaDaily, fromEditorText, toEditorText } from './display'
import { deleteFormula, loadFormulas, MAX_FORMULAS, parseFormulaList, saveFormula, validateFormulaDefinition } from './formulas'
import type { FormulaDefinition } from './formulas'

const measures = [
  { id: 'sleep:duration', label: 'Sleep duration' },
  { id: 'screenTime', label: 'Screen time' },
  { id: 'habit:1', label: 'Water' },
]

const def = (changes: Partial<FormulaDefinition> = {}): FormulaDefinition => ({
  id: 'f_abc12345', name: 'Sleep minus screens', unit: null, display: 'duration', expression: '{sleep:duration} - {screenTime}', ...changes,
})

describe('editor text', () => {
  it('converts between [names] and stored {ids}, case-insensitively', () => {
    expect(fromEditorText('[Sleep duration] - [screen TIME]', measures)).toBe('{sleep:duration} - {screenTime}')
    expect(toEditorText('{sleep:duration} - {screenTime}', measures)).toBe('[Sleep duration] - [Screen time]')
    expect(toEditorText('{gone} * 2', measures)).toBe('[missing: gone] * 2')
  })

  it('explains unknown, ambiguous and unclosed names, and raw ids', () => {
    expect(() => fromEditorText('[Coffee] + 1', measures)).toThrow('There is no measure called "Coffee".')
    expect(() => fromEditorText('[Water] + 1', [...measures, { id: 'habit:2', label: 'water' }])).toThrow(/Several measures are called "Water"/)
    expect(() => fromEditorText('[Water + 1', measures)).toThrow(/not closed/)
    expect(() => fromEditorText('{habit:1} + 1', measures)).toThrow(/Use \[Measure name\]/)
  })
})

describe('daily values', () => {
  const series = [
    { id: 'sleep:duration', daily: [{ date: '2026-11-01', value: 7.5 }, { date: '2026-11-02', value: 6 }, { date: '2026-11-03', value: 8 }] },
    { id: 'screenTime', daily: [{ date: '2026-11-01', value: 2 }, { date: '2026-11-03', value: 3.25 }, { date: '2026-11-04', value: 1 }] },
    { id: 'habit:1', daily: [{ date: '2026-11-01', value: 0 }, { date: '2026-11-03', value: 500 }] },
  ]

  it('calculates only on days where every measure used has a value (hand-calculated)', () => {
    expect(formulaDaily(def(), series)).toEqual({ status: 'ok', daily: [{ date: '2026-11-01', value: 5.5 }, { date: '2026-11-03', value: 4.75 }] })
  })

  it('leaves out days with division by zero', () => {
    expect(formulaDaily(def({ expression: '{screenTime} / {habit:1}', display: 'number' }), series)).toEqual({
      status: 'ok', daily: [{ date: '2026-11-03', value: 3.25 / 500 }],
    })
  })

  it('reports measures that no longer exist', () => {
    expect(formulaDaily(def({ expression: '{habit:deleted} + {screenTime}' }), series)).toEqual({ status: 'missing-measures', missing: ['habit:deleted'] })
  })
})

describe('validation and storage', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(async () => {
    db.close()
    await db.delete()
  })

  it('validates definitions', () => {
    expect(validateFormulaDefinition(def({ name: '  Spaced  ', unit: '  ' }))).toMatchObject({ name: 'Spaced', unit: null })
    expect(() => validateFormulaDefinition(def({ name: '' }))).toThrow(/needs a name/)
    expect(() => validateFormulaDefinition(def({ expression: '1 + 2' }))).toThrow(/at least one measure/)
    expect(() => validateFormulaDefinition(def({ expression: '{formula:f_other1} + 1' }))).toThrow(/cannot use another formula/)
    expect(() => validateFormulaDefinition(def({ expression: 'alert(1)' }))).toThrow(/"alert" is not something/)
    expect(() => validateFormulaDefinition(def({ id: 'x' }))).toThrow(/invalid formula id/)
    expect(() => validateFormulaDefinition(def({ unit: 'x'.repeat(21) }))).toThrow(/at most 20 characters/)
  })

  it('parses only valid lists (unique ids and names, at most 50)', () => {
    expect(parseFormulaList(JSON.stringify([def()]))).toEqual([def()])
    expect(parseFormulaList(JSON.stringify([def(), def({ id: 'f_zzz99999' })]))).toBeNull() // same name
    expect(parseFormulaList(JSON.stringify([def(), def({ name: 'Other' })]))).toBeNull() // same id
    expect(parseFormulaList('{"a":1}')).toBeNull()
    expect(parseFormulaList('nope')).toBeNull()
  })

  it('saves, replaces, refuses duplicate names and too many, and deletes', async () => {
    expect(await loadFormulas()).toEqual([])
    await saveFormula(def())
    await saveFormula(def({ name: 'Renamed' })) // same id → replaced
    expect((await loadFormulas()).map((item) => item.name)).toEqual(['Renamed'])
    await expect(saveFormula(def({ id: 'f_other123', name: 'renamed' }))).rejects.toThrow(/already called "renamed"/)
    for (let i = 1; i < MAX_FORMULAS; i += 1) await saveFormula(def({ id: `f_many${String(i).padStart(4, '0')}`, name: `F${i}` }))
    await expect(saveFormula(def({ id: 'f_toomany1', name: 'One more' }))).rejects.toThrow(/at most 50 formulas/)
    expect(await deleteFormula('f_abc12345')).toHaveLength(MAX_FORMULAS - 1)
  })
})
