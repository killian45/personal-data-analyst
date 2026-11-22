import { describe, expect, it } from 'vitest'

import { checkPassphrase, MIN_PASSPHRASE_LENGTH } from './passphrase'

describe('checkPassphrase', () => {
  it('requires at least 12 characters', () => {
    expect(MIN_PASSPHRASE_LENGTH).toBe(12)
    expect(checkPassphrase('abcdefghijk')).toEqual({ status: 'too-short', length: 11, minimum: 12 })
    expect(checkPassphrase('abcdefghijkl')).toEqual({ status: 'ok', normalized: 'abcdefghijkl' })
    expect(checkPassphrase('')).toEqual({ status: 'too-short', length: 0, minimum: 12 })
  })

  it('counts an emoji or accented letter as one character', () => {
    // 11 letters + 1 emoji (2 UTF-16 code units) = 12 characters.
    expect(checkPassphrase('abcdefghijk😀').status).toBe('ok')
    // 10 letters + 1 emoji = 11 characters, even though .length is 12.
    expect(checkPassphrase('abcdefghij😀')).toMatchObject({ status: 'too-short', length: 11 })
    // "é" typed as e + combining accent becomes one character after NFC.
    expect(checkPassphrase('abcdefghijé')).toMatchObject({ status: 'too-short', length: 11 })
  })

  it('normalises to NFC so the same visible text gives the same passphrase', () => {
    const composed = checkPassphrase('café au lait!')
    const decomposed = checkPassphrase('café au lait!')
    expect(composed).toEqual(decomposed)
  })

  it('keeps spaces and case unchanged', () => {
    expect(checkPassphrase('  Correct Horse  ')).toEqual({ status: 'ok', normalized: '  Correct Horse  ' })
  })
})
