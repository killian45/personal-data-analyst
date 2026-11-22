/**
 * Finds screen text written directly in a file (sharing plan S2), used by
 * noHardcodedText.node.test.ts. Also runnable to list what is left:
 *   node src/i18n/findHardcodedText.node.ts src/components/Foo.tsx
 *
 * Flags: JSX text, text attributes (title, placeholder, aria-label…),
 * any text shown directly in JSX ({busy ? 'Saving' : 'Save'}), text-like
 * object properties ({ label: 'Number' }) and
 * sentence-like strings elsewhere ("Capital word + another word"). Not
 * flagged: console messages (developer logs), import paths, CSS classes,
 * types. A line containing the comment `i18n-ignore` (or following one)
 * is skipped.
 *
 * Parser: rolldown (Vite's own bundler, already installed with Vite).
 */
import { readFileSync } from 'node:fs'

import { parseSync } from 'rolldown/utils'

const TEXT_ATTRIBUTES = new Set(['title', 'description', 'placeholder', 'aria-label', 'alt', 'label', 'summary'])
/** Two letters in a row, or an abbreviation like "e.g.". */
const LETTERS = /[A-Za-z]{2,}|[A-Za-z]\.[A-Za-z]\./
const SENTENCE = /^[A-Z][A-Za-z’']*[ ,.:;!?…-]+[A-Za-z(]/

/**
 * A date-fns pattern such as "d MMM yyyy" or "dd/MM/yyyy HH:mm": runs of
 * pattern letters and separators only, with at least one doubled letter
 * (so words like "day" or "May" are still reported).
 */
export function isDatePattern(text: string): boolean {
  const trimmed = text.trim()
  return /^(?:d+|M+|y+|E+|H+|h+|m+|s+|a+|[ .,:/–-])+$/.test(trimmed) && /dd|MM|yy|EE|HH|hh|mm/.test(trimmed)
}

interface Node {
  type: string
  start: number
  [key: string]: unknown
}

function isNode(value: unknown): value is Node {
  return typeof value === 'object' && value !== null && typeof (value as Node).type === 'string'
}

function isConsoleCall(node: Node): boolean {
  const callee = node.callee as Node | undefined
  return node.type === 'CallExpression' && callee?.type === 'MemberExpression' && (callee.object as Node | undefined)?.type === 'Identifier' && (callee.object as { name?: string }).name === 'console'
}

export function findHardcodedText(file: string, source: string): string[] {
  const { program, errors } = parseSync(file, source, { lang: file.endsWith('x') ? 'tsx' : 'ts' })
  if (errors.length > 0) return [`${file}: could not be parsed`]
  const lineStarts = [0]
  for (let index = 0; index < source.length; index++) if (source[index] === '\n') lineStarts.push(index + 1)
  const lineOf = (offset: number) => {
    let line = 0
    while (line + 1 < lineStarts.length && lineStarts[line + 1] <= offset) line++
    return line
  }
  const lines = source.split('\n')
  const found: string[] = []
  const report = (node: Node, text: string) => {
    if (isDatePattern(text)) return
    const line = lineOf(node.start)
    if (lines[line].includes('i18n-ignore') || (line > 0 && lines[line - 1].includes('i18n-ignore'))) return
    found.push(`${file}:${line + 1}: ${text.trim().replace(/\s+/g, ' ')}`)
  }

  /** inJsx: directly shown in JSX ({…}, through ?: && ||), so any word is screen text. */
  const visit = (node: Node, inJsx = false) => {
    if (isConsoleCall(node) || node.type === 'ImportDeclaration' || node.type.startsWith('TS')) return
    if (inJsx && node.type === 'Literal' && typeof node.value === 'string' && LETTERS.test(node.value)) {
      report(node, node.value)
      return
    }
    if (inJsx && node.type === 'TemplateLiteral') {
      const text = (node.quasis as { value: { cooked: string | null } }[]).map((quasi) => quasi.value.cooked ?? '').join('…')
      if (LETTERS.test(text)) {
        report(node, text)
        return
      }
    }
    if (node.type === 'JSXText' && LETTERS.test(String(node.value))) report(node, String(node.value))
    if (node.type === 'JSXAttribute') {
      const name = (node.name as { name?: string }).name ?? ''
      const value = node.value as Node | null
      if (TEXT_ATTRIBUTES.has(name) && value?.type === 'Literal' && LETTERS.test(String(value.value))) {
        report(value, `${name}="${String(value.value)}"`)
        return
      }
      // {…} in a non-text attribute (className, type, key…) is not shown.
      if (!TEXT_ATTRIBUTES.has(name) && value?.type === 'JSXExpressionContainer') {
        visit(value.expression as Node)
        return
      }
    }
    // { label: 'Number' }: text-like property names hold screen text.
    if (node.type === 'Property' && !node.computed) {
      const key = node.key as { name?: string; value?: unknown }
      const value = node.value as Node
      const name = key.name ?? (typeof key.value === 'string' ? key.value : '')
      if (TEXT_ATTRIBUTES.has(name) && value.type === 'Literal' && typeof value.value === 'string' && LETTERS.test(value.value)) {
        report(value, `${name}: ${value.value}`)
        return
      }
    }
    if (node.type === 'Literal' && typeof node.value === 'string' && SENTENCE.test(node.value.trim())) report(node, node.value)
    if (node.type === 'TemplateLiteral') {
      const text = (node.quasis as { value: { cooked: string | null } }[]).map((quasi) => quasi.value.cooked ?? '').join('…')
      if (SENTENCE.test(text.trim())) report(node, text)
    }
    const childInJsx =
      node.type === 'JSXExpressionContainer' ||
      (inJsx && (node.type === 'ConditionalExpression' || node.type === 'LogicalExpression'))
    for (const [key, value] of Object.entries(node)) {
      // The condition of a ?: is not shown.
      const shown = childInJsx && !(node.type === 'ConditionalExpression' && key === 'test')
      if (Array.isArray(value)) value.forEach((child) => isNode(child) && visit(child, shown))
      else if (isNode(value)) visit(value, shown)
    }
  }
  visit(program as unknown as Node)
  return found
}

if (process.argv[1]?.endsWith('findHardcodedText.node.ts')) {
  for (const file of process.argv.slice(2)) {
    const found = findHardcodedText(file, readFileSync(file, 'utf8'))
    console.log(`${file}: ${found.length}`)
    for (const line of found) console.log(`  ${line}`)
  }
}
