import { describe, expect, it } from 'vitest'

import { evaluateFormula, FormulaError, measuresUsed, parseFormula } from './parser'

const calc = (text: string, values: Record<string, number> = {}) => evaluateFormula(parseFormula(text), new Map(Object.entries(values)))

describe('parseFormula + evaluateFormula', () => {
  it('follows the usual order of operations (hand-calculated)', () => {
    expect(calc('2 + 3 * 4')).toBe(14)
    expect(calc('(2 + 3) * 4')).toBe(20)
    expect(calc('10 - 4 - 3')).toBe(3) // left to right
    expect(calc('8 / 4 / 2')).toBe(1)
    expect(calc('-2 * 3')).toBe(-6)
    expect(calc('--2')).toBe(2)
    expect(calc('+5 - -1')).toBe(6)
    expect(calc('.5 + 1.25')).toBe(1.75)
  })

  it('accepts typographic operators', () => {
    expect(calc('6 × 2 ÷ 3 − 1')).toBe(3)
  })

  it('uses measure values, and gives no value when one is missing', () => {
    expect(calc('{sleep:duration} - {screenTime}', { 'sleep:duration': 7.5, screenTime: 2 })).toBe(5.5)
    expect(calc('{sleep:duration} - {screenTime}', { 'sleep:duration': 7.5 })).toBeNull()
  })

  it('gives no value for division by zero (never 0 or infinity)', () => {
    expect(calc('{a} / {b}', { a: 3, b: 0 })).toBeNull()
    expect(calc('1 / (2 - 2)')).toBeNull()
  })

  it('supports min, max, abs and round', () => {
    expect(calc('min(3, 1, 2)')).toBe(1)
    expect(calc('max({a}, 5000)', { a: 4200 })).toBe(5000)
    expect(calc('abs(-2.5)')).toBe(2.5)
    expect(calc('round(1250 / 250)')).toBe(5)
    expect(calc('round(2.5)')).toBe(3) // halves round up
    expect(calc('MAX(1, 2)')).toBe(2) // case does not matter
  })

  it('lists the measures used, once each', () => {
    expect(measuresUsed(parseFormula('{a} + max({b}, {a}) / -{c}'))).toEqual(['a', 'b', 'c'])
  })
})

describe('mistakes get plain-language messages', () => {
  it.each([
    ['', /empty/],
    ['2 +', /ends too early/],
    ['(2 + 3', /closing parenthesis/],
    ['2 + 3)', /Unexpected "\)"/],
    ['2 3', /Unexpected "3"/],
    ['* 2', /Something is missing/],
    ['1,5 + 2', /Unexpected ","/],
    ['1..2', /number is not written correctly/],
    ['sqrt(4)', /"sqrt" is not something a formula knows/],
    ['min(1)', /min takes 2 to 10 values/],
    ['abs(1, 2)', /abs takes exactly 1 value/],
    ['abs 2', /"abs" must be followed by "\("/],
    ['{}', /measure reference is not written correctly/],
    ['{unclosed', /measure reference is not written correctly/],
    ['2 ^ 3', /"\^" cannot be used/],
  ])('%s', (text, message) => {
    expect(() => parseFormula(text)).toThrow(FormulaError)
    expect(() => parseFormula(text)).toThrow(message)
  })
})

describe('hostile input is refused, never run', () => {
  it.each([
    'alert(1)',
    'constructor',
    '__proto__',
    'process.exit()',
    'globalThis',
    '1; fetch("https://example.com")',
    '`${1}`',
    'this',
    '{a}.constructor',
    '[1] + 1',
    "'2' + 1",
    '{x}} + 1',
  ])('%s', (text) => {
    expect(() => parseFormula(text)).toThrow(FormulaError)
  })

  it('limits length, nesting and measure uses', () => {
    expect(() => parseFormula('1+'.repeat(260) + '1')).toThrow(/at most 500 characters/)
    expect(() => parseFormula('('.repeat(30) + '1' + ')'.repeat(30))).toThrow(/too many nested parts/)
    expect(() => parseFormula('-'.repeat(30) + '1')).toThrow(/too many nested parts/)
    expect(() => parseFormula(Array(11).fill('{a}').join('+'))).toThrow(/at most 10 times/)
    expect(() => parseFormula(Array(150).fill('1').join('+'))).toThrow(/too long/)
    expect(calc('('.repeat(15) + '1' + ')'.repeat(15))).toBe(1)
  })
})
