import { describe, expect, it } from 'vitest'

import { formatRecoveryKey, parseRecoveryKey, RECOVERY_KEY_BYTES } from './recoveryKey'

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

function randomKey(): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(RECOVERY_KEY_BYTES))
}

function parsedBytes(text: string): number[] {
  const parsed = parseRecoveryKey(text)
  if (parsed.status !== 'ok') throw new Error(`expected ok, got ${parsed.reason}`)
  return [...parsed.bytes]
}

describe('formatRecoveryKey', () => {
  it('writes 28 characters in 7 groups of 4 using Crockford base32', () => {
    const text = formatRecoveryKey(randomKey())
    expect(text).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){6}$/)
  })

  it('all-zero key: every value is 0, so the check is 0 (hand-calculated)', () => {
    expect(formatRecoveryKey(new Uint8Array(16))).toBe('0000-0000-0000-0000-0000-0000-0000')
  })

  it('all-ones key (hand-calculated)', () => {
    // 128 one-bits in 26 five-bit characters (130 bits): the first character
    // holds 2 zero bits and 3 one-bits (value 7), the other 25 are 31 ("Z").
    // Check = (1×7 + 31×(2+3+…+26)) mod 1021 = (7 + 31×350) mod 1021
    //       = 10857 mod 1021 = 647 = 20×32 + 7 → "M7".
    expect(formatRecoveryKey(new Uint8Array(16).fill(0xff))).toBe('7ZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZM7')
  })

  it('key 00…01 (hand-calculated)', () => {
    // Only the last data character is 1 (position 26): check = 26 = 0×32 + 26 → "0T".
    const bytes = new Uint8Array(16)
    bytes[15] = 1
    expect(formatRecoveryKey(bytes)).toBe('0000-0000-0000-0000-0000-0000-010T')
  })

  it('refuses a key that is not 16 bytes', () => {
    expect(() => formatRecoveryKey(new Uint8Array(15))).toThrow(RangeError)
  })
})

describe('parseRecoveryKey', () => {
  it('reads back what was formatted (many random keys)', () => {
    for (let i = 0; i < 200; i++) {
      const bytes = randomKey()
      expect(parsedBytes(formatRecoveryKey(bytes))).toEqual([...bytes])
    }
  })

  it('accepts lower case, spaces, missing hyphens and look-alike letters', () => {
    const expected = new Array(16).fill(0xff)
    expect(parsedBytes('7zzz-zzzz-zzzz-zzzz-zzzz-zzzz-zzm7')).toEqual(expected)
    expect(parsedBytes(' 7ZZZ ZZZZ ZZZZ ZZZZ ZZZZ ZZZZ ZZM7 ')).toEqual(expected)
    expect(parsedBytes('7ZZZZZZZZZZZZZZZZZZZZZZZZZM7')).toEqual(expected)

    const one = new Array(16).fill(0)
    one[15] = 1
    expect(parsedBytes('OOOO-oooo-0000-0000-0000-0000-0I0T')).toEqual(one)
    expect(parsedBytes('0000-0000-0000-0000-0000-0000-0L0T')).toEqual(one)
  })

  it('reports a wrong length', () => {
    expect(parseRecoveryKey('0000-0000-0000-0000-0000-0000-000')).toEqual({ status: 'invalid', reason: 'length' })
    expect(parseRecoveryKey('')).toEqual({ status: 'invalid', reason: 'length' })
  })

  it('reports characters outside the alphabet (U is not used)', () => {
    expect(parseRecoveryKey('U000-0000-0000-0000-0000-0000-0000')).toEqual({
      status: 'invalid',
      reason: 'character',
    })
  })

  it('detects every single-character mistake', () => {
    const text = formatRecoveryKey(randomKey()).replace(/-/g, '')
    for (let position = 0; position < text.length; position++) {
      for (const replacement of ALPHABET) {
        if (replacement === text[position]) continue
        const typo = text.slice(0, position) + replacement + text.slice(position + 1)
        expect(parseRecoveryKey(typo).status, `${position}:${replacement}`).toBe('invalid')
      }
    }
  })

  it('detects swapped neighbouring data characters', () => {
    for (let attempt = 0; attempt < 20; attempt++) {
      const text = formatRecoveryKey(randomKey()).replace(/-/g, '')
      for (let i = 0; i < 25; i++) {
        if (text[i] === text[i + 1]) continue
        const swapped = text.slice(0, i) + text[i + 1] + text[i] + text.slice(i + 2)
        expect(parseRecoveryKey(swapped).status).toBe('invalid')
      }
    }
  })

  it('refuses a value larger than 128 bits even with a matching check', () => {
    // First character 8 → bit 129 set. Check = 1×8 = 8 → "08".
    expect(parseRecoveryKey('8000-0000-0000-0000-0000-0000-0008')).toEqual({
      status: 'invalid',
      reason: 'checksum',
    })
  })
})
