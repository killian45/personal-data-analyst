import { describe, expect, it } from 'vitest'

import stylesheet from '../index.css?raw'

/**
 * Guards dark mode: every light colour class used in a component must
 * have a dark-mode mapping in src/index.css (see the "Dark mode" section).
 */

const components = import.meta.glob<string>(
  ['../**/*.tsx', '!../**/*.test.tsx'],
  { query: '?raw', import: 'default', eager: true },
)

// Classes that already work on dark backgrounds and are not remapped.
const UNCHANGED = new Set([
  'text-white',
  'bg-blue-600',
  'hover:bg-blue-700',
  'bg-red-600',
  'hover:bg-red-700',
  'focus:border-blue-500',
  'border-blue-500',
])

const COLOUR_CLASS =
  /(?<![\w:-])((?:hover:|focus:|disabled:|active:)?(?:bg|text|border|ring|divide|outline|placeholder|from|to|via|fill|stroke|accent|caret|decoration)-(?:white|black|slate|gray|zinc|neutral|stone|blue|sky|indigo|red|rose|green|emerald|amber|yellow|orange|purple|violet|pink)(?:-\d{2,3})?)(?![\w-])/g

function cssSelector(className: string): string {
  const [variant, base] = className.includes(':')
    ? className.split(':')
    : [null, className]

  return variant ? `.${variant}\\:${base}:${variant}` : `.${base}`
}

const darkSection = stylesheet.slice(
  stylesheet.indexOf('@media (prefers-color-scheme: dark)'),
)

describe('dark mode', () => {
  it('has a dark mode section', () => {
    expect(darkSection.length).toBeGreaterThan(0)
  })

  it('finds the component files to check', () => {
    expect(Object.keys(components).length).toBeGreaterThan(3)
  })

  it('maps every light colour class used in the interface', () => {
    const used = new Set<string>()

    for (const source of Object.values(components)) {
      for (const match of source.matchAll(COLOUR_CLASS)) {
        used.add(match[1])
      }
    }

    const missing = [...used]
      .filter((className) => !UNCHANGED.has(className))
      .filter((className) => !darkSection.includes(cssSelector(className)))
      .sort()

    expect(missing).toEqual([])
  })
})
