import { describe, expect, it } from 'vitest'

import {
  MAX_CONTACT_NAME_LENGTH,
  MAX_CONTACT_TEXT_LENGTH,
  MAX_INTERACTION_TEXT_LENGTH,
  birthdayHasYear,
  normalizeBirthday,
  normalizeContactName,
  normalizeContactText,
  normalizeExternalPhoneId,
  normalizeInteractionText,
} from './contactFields'

describe('normalizeContactName', () => {
  it('trims and requires a name', () => {
    expect(normalizeContactName('  Amélie Dupont ')).toBe('Amélie Dupont')
    expect(() => normalizeContactName('   ')).toThrow('Name is required.')
    expect(() => normalizeContactName(42)).toThrow('Name must be text.')
  })

  it('accepts the maximum length and refuses one more character', () => {
    expect(normalizeContactName('a'.repeat(MAX_CONTACT_NAME_LENGTH))).toHaveLength(MAX_CONTACT_NAME_LENGTH)
    expect(() => normalizeContactName('a'.repeat(MAX_CONTACT_NAME_LENGTH + 1))).toThrow('cannot exceed')
  })
})

describe('normalizeContactText', () => {
  it('trims; empty or missing means unknown (null), never ""', () => {
    expect(normalizeContactText('  likes jazz \n', 'Interests')).toBe('likes jazz')
    expect(normalizeContactText('   ', 'Interests')).toBeNull()
    expect(normalizeContactText(null, 'Interests')).toBeNull()
    expect(normalizeContactText(undefined, 'Interests')).toBeNull()
  })

  it('keeps line breaks inside the text', () => {
    expect(normalizeContactText('12 rue X\n75011 Paris', 'Address')).toBe('12 rue X\n75011 Paris')
  })

  it('refuses non-text and too-long text, naming the field', () => {
    expect(() => normalizeContactText(5, 'Address')).toThrow('Address must be text.')
    expect(normalizeContactText('a'.repeat(MAX_CONTACT_TEXT_LENGTH), 'Address')).toHaveLength(MAX_CONTACT_TEXT_LENGTH)
    expect(() => normalizeContactText('a'.repeat(MAX_CONTACT_TEXT_LENGTH + 1), 'Address')).toThrow('Address cannot exceed')
  })
})

describe('normalizeBirthday', () => {
  it('accepts a full date and a day-and-month without year', () => {
    expect(normalizeBirthday('1990-05-17')).toBe('1990-05-17')
    expect(normalizeBirthday('--05-17')).toBe('--05-17')
    expect(normalizeBirthday(' 1990-05-17 ')).toBe('1990-05-17')
  })

  it('empty or missing means unknown', () => {
    expect(normalizeBirthday('')).toBeNull()
    expect(normalizeBirthday(null)).toBeNull()
    expect(normalizeBirthday(undefined)).toBeNull()
  })

  it('29 February: only in leap years, always allowed without a year', () => {
    expect(normalizeBirthday('2000-02-29')).toBe('2000-02-29') // divisible by 400: leap
    expect(normalizeBirthday('1996-02-29')).toBe('1996-02-29')
    expect(() => normalizeBirthday('1900-02-29')).toThrow('not a real calendar date') // divisible by 100: not leap
    expect(() => normalizeBirthday('2023-02-29')).toThrow('not a real calendar date')
    expect(normalizeBirthday('--02-29')).toBe('--02-29')
    expect(() => normalizeBirthday('--02-30')).toThrow('not a real calendar date')
  })

  it('refuses impossible days and months', () => {
    expect(() => normalizeBirthday('1990-04-31')).toThrow('not a real calendar date')
    expect(() => normalizeBirthday('1990-13-01')).toThrow('not a real calendar date')
    expect(() => normalizeBirthday('1990-00-10')).toThrow('not a real calendar date')
    expect(() => normalizeBirthday('--12-00')).toThrow('not a real calendar date')
    expect(normalizeBirthday('1990-12-31')).toBe('1990-12-31')
  })

  it('refuses other formats', () => {
    for (const value of ['17/05/1990', '1990-5-17', '05-17', '--5-17', '1990-05-17T00:00:00Z', '0999-01-01']) {
      expect(() => normalizeBirthday(value), value).toThrow()
    }
    expect(() => normalizeBirthday(19900517)).toThrow('Birthday must be text.')
  })

  it('tells whether the year is known', () => {
    expect(birthdayHasYear('1990-05-17')).toBe(true)
    expect(birthdayHasYear('--05-17')).toBe(false)
  })
})

describe('normalizeInteractionText', () => {
  it('trims and requires text', () => {
    expect(normalizeInteractionText(' Coffee at Café Oz ')).toBe('Coffee at Café Oz')
    expect(() => normalizeInteractionText('  ')).toThrow('Describe the interaction.')
    expect(() => normalizeInteractionText('a'.repeat(MAX_INTERACTION_TEXT_LENGTH + 1))).toThrow('cannot exceed')
  })
})

describe('normalizeExternalPhoneId', () => {
  it('accepts an identifier or nothing', () => {
    expect(normalizeExternalPhoneId('1234')).toBe('1234')
    expect(normalizeExternalPhoneId(null)).toBeNull()
    expect(normalizeExternalPhoneId(undefined)).toBeNull()
    expect(() => normalizeExternalPhoneId('')).toThrow()
    expect(() => normalizeExternalPhoneId(12)).toThrow()
  })
})
