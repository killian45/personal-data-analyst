import { describe, expect, it } from 'vitest'

import { commentTemplate, cleanComment, commentForEditing } from './commentTemplate'

describe('commentTemplate()', () => {
  it('has the four prompts, one per line', () => {
    expect(commentTemplate()).toBe('Why: \nIncreased: \nDecreased: \nNext experiment: ')
  })
})

describe('cleanComment', () => {
  it('an untouched template becomes an empty comment', () => {
    expect(cleanComment(commentTemplate())).toBe('')
  })

  it('keeps filled prompts and removes empty ones', () => {
    const text = 'Why: bad sleep\nIncreased: \nDecreased: coffee\nNext experiment: '
    expect(cleanComment(text)).toBe('Why: bad sleep\nDecreased: coffee')
  })

  it('removes empty prompts with extra spaces, any case, Windows line ends', () => {
    expect(cleanComment('  why:   \r\nINCREASED:\r\nNext experiment: walk')).toBe(
      'Next experiment: walk',
    )
  })

  it('keeps free text written outside the prompts', () => {
    expect(cleanComment('Why: \nJust a normal day\nDecreased: ')).toBe('Just a normal day')
  })

  it('leaves a comment without prompts unchanged apart from trimming', () => {
    expect(cleanComment('  great run  ')).toBe('great run')
    expect(cleanComment('')).toBe('')
  })
})

describe('commentForEditing', () => {
  it('shows the prompts when there is no comment', () => {
    expect(commentForEditing(null)).toBe(commentTemplate())
    expect(commentForEditing('')).toBe(commentTemplate())
  })

  it('shows an existing comment unchanged', () => {
    expect(commentForEditing('old note')).toBe('old note')
  })
})
