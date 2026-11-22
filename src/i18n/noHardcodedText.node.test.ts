// @vitest-environment node
/**
 * Safety net for the translation work (sharing plan S2): every screen file
 * (.tsx outside tests, found automatically) and the few .ts helpers that
 * build screen text must take every text from src/i18n, so none is
 * forgotten when another language is added. A new screen is checked
 * without being added here. Text that is not shown (a word the user must
 * type, an internal object) is marked with an i18n-ignore comment.
 */
import { readdirSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { findHardcodedText, isDatePattern } from './findHardcodedText.node.ts'

/** .ts files (not components) that build screen text. */
const SCREEN_TEXT_HELPERS = [
  'src/components/habits/habitTypes.ts',
  'src/components/dashboard/sectionTiles.ts',
  'src/components/dashboard/periodLabels.ts',
]

const SCREEN_FILES = readdirSync('src', { recursive: true, encoding: 'utf8' })
  .map((file) => `src/${file.replaceAll('\\', '/')}`)
  .filter((file) => file.endsWith('.tsx') && !file.endsWith('.test.tsx'))
  .sort()

const TRANSLATED_FILES = [...SCREEN_FILES, ...SCREEN_TEXT_HELPERS]

describe('no hard-coded screen text in translated files', () => {
  it('ignores date patterns but not short words (S2j)', () => {
    for (const pattern of ['d MMM', 'MMM yyyy', 'd MMM yyyy', 'EEE d MMM yyyy', 'dd/MM/yyyy HH:mm', 'HH:mm']) {
      expect(isDatePattern(pattern)).toBe(true)
    }
    for (const word of ['day', 'May', 'Day', 'Done', 'mm hmm ok', 'Save']) {
      expect(isDatePattern(word)).toBe(false)
    }
  })

  it('finds the screen files (the check is not silently empty)', () => {
    expect(SCREEN_FILES).toContain('src/App.tsx')
    expect(SCREEN_FILES).toContain('src/components/SyncPanel.tsx')
    expect(SCREEN_FILES).toContain('src/components/dashboard/Dashboard.tsx')
    expect(SCREEN_FILES.some((file) => file.endsWith('.test.tsx'))).toBe(false)
    expect(SCREEN_FILES.length).toBeGreaterThan(60)
  })

  it('finds text the check is meant to catch (self-test)', () => {
    const sample = [
      'export function A({ busy }: { busy: boolean }) {',
      '  console.error("Failed to load data:")',
      '  const css = "rounded-lg bg-white px-3"',
      '  const error = "Could not save habit."',
      '  return <p title="Hello there" className={busy ? "text-xs font-medium" : css}>Loading data... {busy ? `Saving ${1} item` : "ok"} {busy === "x" && "Save"} {busy ? ` · target ${2}` : ""}</p>',
      '}',
      'const types = [{ value: "number", label: "Number" }]',
      'const brand = "Health Connect" // i18n-ignore',
    ].join('\n')
    expect(findHardcodedText('sample.tsx', sample)).toEqual([
      'sample.tsx:4: Could not save habit.',
      'sample.tsx:5: title="Hello there"',
      'sample.tsx:5: Loading data...',
      'sample.tsx:5: Saving … item',
      'sample.tsx:5: ok',
      'sample.tsx:5: Save',
      'sample.tsx:5: · target …',
      'sample.tsx:7: label: Number',
    ])
  })

  it.each(TRANSLATED_FILES)('%s takes its texts from src/i18n', (file) => {
    expect(findHardcodedText(file, readFileSync(file, 'utf8'))).toEqual([])
  })
})
