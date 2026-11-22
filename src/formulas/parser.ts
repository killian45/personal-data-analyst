import { messages } from '../i18n'
/**
 * Safe formula language for custom measures (Phase 6 step 4,
 * docs/PHASE6_PLAN.md §4). Pure functions; NOTHING is ever executed as
 * code (no eval, no Function): text → tokens → a small tree → evaluated by
 * this file's own code.
 *
 * Stored form: measures are written {measure-id}, e.g.
 *   "({sleep:duration} - {screenTime}) * 60"
 * The editor shows [Measure name] instead (see src/formulas/display.ts).
 *
 * Grammar:
 *   expression := term (("+" | "-") term)*
 *   term       := unary (("*" | "/") unary)*
 *   unary      := ("-" | "+") unary | primary
 *   primary    := number | "{" id "}" | function "(" expression ("," expression)* ")" | "(" expression ")"
 *   function   := min | max (2 to 10 arguments) | abs | round (1 argument)
 * Also accepted: × ÷ − (typographic operators). Numbers use a dot.
 *
 * Limits: 500 characters, 200 tokens, nesting depth 20, 10 measure uses.
 * Evaluation: a missing measure value, division by zero or a non-finite
 * result gives null ("no value" — never 0 or infinity).
 */

export const MAX_FORMULA_LENGTH = 500
const MAX_TOKENS = 200
const MAX_DEPTH = 20
export const MAX_MEASURE_USES = 10

export type FormulaNode =
  | { type: 'number'; value: number }
  | { type: 'measure'; id: string }
  | { type: 'negate'; arg: FormulaNode }
  | { type: 'binary'; op: '+' | '-' | '*' | '/'; left: FormulaNode; right: FormulaNode }
  | { type: 'call'; fn: 'min' | 'max' | 'abs' | 'round'; args: FormulaNode[] }

type Token =
  | { kind: 'number'; value: number; at: number }
  | { kind: 'measure'; id: string; at: number }
  | { kind: 'name'; name: string; at: number }
  | { kind: 'op'; op: '+' | '-' | '*' | '/'; at: number }
  | { kind: '(' | ')' | ','; at: number }

export class FormulaError extends Error {}

const FUNCTIONS = { min: [2, 10], max: [2, 10], abs: [1, 1], round: [1, 1] } as const
const OPERATORS: Record<string, '+' | '-' | '*' | '/'> = { '+': '+', '-': '-', '−': '-', '*': '*', '×': '*', '/': '/', '÷': '/' }
const MEASURE_ID = /^[A-Za-z0-9:_\-.,@ ]{1,300}$/

function tokenize(text: string): Token[] {
  if (text.length > MAX_FORMULA_LENGTH) throw new FormulaError(messages().formulaText.tooLong(MAX_FORMULA_LENGTH))
  const tokens: Token[] = []
  let i = 0
  while (i < text.length) {
    const char = text[i]
    if (/\s/.test(char)) {
      i += 1
    } else if (/[0-9.]/.test(char)) {
      const match = /^(\d+(\.\d+)?|\.\d+)/.exec(text.slice(i))
      if (!match) throw new FormulaError(messages().formulaText.badNumber(i + 1))
      tokens.push({ kind: 'number', value: Number(match[0]), at: i })
      i += match[0].length
    } else if (char === '{') {
      const end = text.indexOf('}', i)
      const id = end === -1 ? '' : text.slice(i + 1, end)
      if (end === -1 || !MEASURE_ID.test(id)) throw new FormulaError(messages().formulaText.badReference(i + 1))
      tokens.push({ kind: 'measure', id, at: i })
      i = end + 1
    } else if (/[a-z]/i.test(char)) {
      const match = /^[a-z]+/i.exec(text.slice(i)) as RegExpExecArray
      tokens.push({ kind: 'name', name: match[0].toLowerCase(), at: i })
      i += match[0].length
    } else if (char in OPERATORS) {
      tokens.push({ kind: 'op', op: OPERATORS[char], at: i })
      i += 1
    } else if (char === '(' || char === ')' || char === ',') {
      tokens.push({ kind: char, at: i })
      i += 1
    } else {
      throw new FormulaError(`"${char}" cannot be used in a formula (position ${i + 1}).`)
    }
    if (tokens.length > MAX_TOKENS) throw new FormulaError(messages().formulaText.tooManyParts)
  }
  return tokens
}

/** Parses a stored formula into a tree. Throws FormulaError with a plain-language reason. */
export function parseFormula(text: string): FormulaNode {
  const tokens = tokenize(text)
  if (tokens.length === 0) throw new FormulaError(messages().formulaText.empty)
  let position = 0
  let measureUses = 0

  const peek = () => tokens[position]
  const fail = (message: string): never => {
    throw new FormulaError(message)
  }

  function expression(depth: number): FormulaNode {
    if (depth > MAX_DEPTH) fail(messages().formulaText.tooNested)
    let node = term(depth)
    for (let token = peek(); token?.kind === 'op' && (token.op === '+' || token.op === '-'); token = peek()) {
      position += 1
      node = { type: 'binary', op: token.op, left: node, right: term(depth) }
    }
    return node
  }

  function term(depth: number): FormulaNode {
    let node = unary(depth)
    for (let token = peek(); token?.kind === 'op' && (token.op === '*' || token.op === '/'); token = peek()) {
      position += 1
      node = { type: 'binary', op: token.op, left: node, right: unary(depth) }
    }
    return node
  }

  function unary(depth: number): FormulaNode {
    if (depth > MAX_DEPTH) fail(messages().formulaText.tooNested)
    const token = peek()
    if (token?.kind === 'op' && (token.op === '-' || token.op === '+')) {
      position += 1
      const arg = unary(depth + 1)
      return token.op === '-' ? { type: 'negate', arg } : arg
    }
    return primary(depth)
  }

  function primary(depth: number): FormulaNode {
    const token = peek()
    if (!token) return fail(messages().formulaText.endsEarly)
    position += 1
    switch (token.kind) {
      case 'number':
        return { type: 'number', value: token.value }
      case 'measure':
        measureUses += 1
        if (measureUses > MAX_MEASURE_USES) fail(messages().formulaText.tooManyMeasures(MAX_MEASURE_USES))
        return { type: 'measure', id: token.id }
      case '(': {
        const inner = expression(depth + 1)
        if (peek()?.kind !== ')') fail(messages().formulaText.closingMissing)
        position += 1
        return inner
      }
      case 'name': {
        if (!(token.name in FUNCTIONS)) fail(`"${token.name}" is not something a formula knows (use min, max, abs or round).`)
        const fn = token.name as keyof typeof FUNCTIONS
        if (peek()?.kind !== '(') fail(`"${fn}" must be followed by "(".`)
        position += 1
        const args = [expression(depth + 1)]
        while (peek()?.kind === ',') {
          position += 1
          args.push(expression(depth + 1))
        }
        if (peek()?.kind !== ')') fail(messages().formulaText.closingMissingAfter(fn))
        position += 1
        const [low, high] = FUNCTIONS[fn]
        if (args.length < low || args.length > high) {
          fail(low === high ? `${fn} takes exactly ${low} value.` : `${fn} takes ${low} to ${high} values.`)
        }
        return { type: 'call', fn, args }
      }
      default:
        return fail(messages().formulaText.missingBefore(token.at + 1))
    }
  }

  const tree = expression(0)
  if (position < tokens.length) fail(`Unexpected "${tokenText(tokens[position])}" at position ${tokens[position].at + 1}.`)
  return tree
}

function tokenText(token: Token): string {
  switch (token.kind) {
    case 'number': return String(token.value)
    case 'measure': return `{${token.id}}`
    case 'name': return token.name
    case 'op': return token.op
    default: return token.kind
  }
}

/** The measure ids a formula uses (each once, in order of appearance). */
export function measuresUsed(node: FormulaNode): string[] {
  const ids: string[] = []
  const visit = (current: FormulaNode) => {
    if (current.type === 'measure' && !ids.includes(current.id)) ids.push(current.id)
    if (current.type === 'negate') visit(current.arg)
    if (current.type === 'binary') {
      visit(current.left)
      visit(current.right)
    }
    if (current.type === 'call') current.args.forEach(visit)
  }
  visit(node)
  return ids
}

/** Evaluates a tree with the given measure values; null = no value. */
export function evaluateFormula(node: FormulaNode, values: ReadonlyMap<string, number>): number | null {
  const result = evaluate(node, values)
  return result !== null && Number.isFinite(result) ? result : null
}

function evaluate(node: FormulaNode, values: ReadonlyMap<string, number>): number | null {
  switch (node.type) {
    case 'number':
      return node.value
    case 'measure': {
      const value = values.get(node.id)
      return value === undefined || !Number.isFinite(value) ? null : value
    }
    case 'negate': {
      const value = evaluate(node.arg, values)
      return value === null ? null : -value
    }
    case 'binary': {
      const left = evaluate(node.left, values)
      const right = evaluate(node.right, values)
      if (left === null || right === null) return null
      switch (node.op) {
        case '+': return left + right
        case '-': return left - right
        case '*': return left * right
        case '/': return right === 0 ? null : left / right
      }
      break
    }
    case 'call': {
      const args = node.args.map((arg) => evaluate(arg, values))
      if (args.some((arg) => arg === null)) return null
      const numbers = args as number[]
      switch (node.fn) {
        case 'min': return Math.min(...numbers)
        case 'max': return Math.max(...numbers)
        case 'abs': return Math.abs(numbers[0])
        case 'round': return Math.round(numbers[0])
      }
    }
  }
  return null
}
