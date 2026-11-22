import { describe, expect, it } from 'vitest'

import { getLanguage, messages, plural, setLanguage } from '.'

describe('translations', () => {
  it('starts in English and sets the page language', () => {
    expect(getLanguage()).toBe('en')
    setLanguage('en')
    expect(document.documentElement.lang).toBe('en')
    expect(messages().app.name).toBe('Personal Data Analyst')
  })

  it('picks plural forms with the language rules (English: 1 = one, 0 and 2 = other)', () => {
    const forms = { one: 'day', other: 'days' }
    expect([0, 1, 2, 1.5].map((count) => plural(count, forms))).toEqual(['days', 'day', 'days', 'days'])
    expect(messages().habitList.total(1)).toBe('1 total habit')
    expect(messages().habitList.total(3)).toBe('3 total habits')
  })

  it('fills values into texts', () => {
    expect(messages().stopwatch.started('Walk')).toBe('Stopwatch started: Walk.')
    expect(messages().habitList.confirmDelete('Walk')).toBe(
      'Delete "Walk"? Its existing entries will be preserved but the habit will no longer appear in the application.',
    )
  })
})
