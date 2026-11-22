import { describe, expect, it } from 'vitest'

import type { Contact } from '../database/types'

import {
  birthdayInputMessage,
  contactChanges,
  EMPTY_CONTACT_FORM,
  fieldsFromInstant,
  filterContacts,
  formatBirthdayInput,
  formFromContact,
  interactionTimeFromFields,
  isContactFormDirty,
  newContactInput,
  parseBirthdayInput,
} from './contactForm'

function contact(changes: Partial<Contact> = {}): Contact {
  return {
    id: 'c-1', name: 'Amélie', description: null, education: 'MSc Physics', address: '12 rue X\n75011 Paris',
    birthday: '--05-17', interests: 'Jazz, hiking', dislikes: null, externalPhoneId: null,
    syncStatus: 'pending', revision: 1, syncedRevision: null,
    createdAt: '2026-11-12T10:00:00.000Z', updatedAt: '2026-11-12T10:00:00.000Z', deletedAt: null,
    ...changes,
  }
}

describe('filterContacts', () => {
  const people = [
    contact({ id: '1', name: 'Émile Zola', interests: 'Writing' }),
    contact({ id: '2', name: 'Bob', interests: 'Jazz', address: 'Lyon' }),
    contact({ id: '3', name: 'Alice', interests: null, education: null, address: null }),
  ]

  it('returns everyone for an empty query', () => {
    expect(filterContacts(people, '   ')).toEqual(people)
  })

  it('ignores case and accents', () => {
    expect(filterContacts(people, 'EMILE').map((c) => c.id)).toEqual(['1'])
  })

  it('searches every text field and needs every word', () => {
    expect(filterContacts(people, 'jazz').map((c) => c.id)).toEqual(['2'])
    expect(filterContacts(people, 'physics').map((c) => c.id)).toEqual(['1', '2']) // education field
    expect(filterContacts(people, 'jazz lyon').map((c) => c.id)).toEqual(['2'])
    expect(filterContacts(people, 'nobody')).toEqual([])
  })
})

describe('birthday field', () => {
  it('reads a full date and a day and month', () => {
    expect(parseBirthdayInput('17/05/1990')).toEqual({ ok: true, birthday: '1990-05-17' })
    expect(parseBirthdayInput('7.5.1990')).toEqual({ ok: true, birthday: '1990-05-07' })
    expect(parseBirthdayInput('17/05')).toEqual({ ok: true, birthday: '--05-17' })
    expect(parseBirthdayInput('7/5')).toEqual({ ok: true, birthday: '--05-07' })
    expect(parseBirthdayInput('  ')).toEqual({ ok: true, birthday: null })
  })

  it('29/02 without a year is allowed, impossible dates are not', () => {
    expect(parseBirthdayInput('29/02')).toEqual({ ok: true, birthday: '--02-29' })
    expect(parseBirthdayInput('29/02/2023')).toEqual({ ok: false, message: birthdayInputMessage() })
    expect(parseBirthdayInput('31/04')).toEqual({ ok: false, message: birthdayInputMessage() })
    expect(parseBirthdayInput('1990-05-17')).toEqual({ ok: false, message: birthdayInputMessage() })
    expect(parseBirthdayInput('May 17')).toEqual({ ok: false, message: birthdayInputMessage() })
  })

  it('shows a stored birthday in the field format', () => {
    expect(formatBirthdayInput('1990-05-17')).toBe('17/05/1990')
    expect(formatBirthdayInput('--05-17')).toBe('17/05')
    expect(formatBirthdayInput(null)).toBe('')
  })
})

describe('contact form', () => {
  it('shows a contact, empty fields as ""', () => {
    expect(formFromContact(contact())).toEqual({
      name: 'Amélie', description: '', education: 'MSc Physics', address: '12 rue X\n75011 Paris',
      birthday: '17/05', interests: 'Jazz, hiking', dislikes: '',
    })
  })

  it('is dirty only when a field differs from the contact', () => {
    const c = contact()
    expect(isContactFormDirty(c, formFromContact(c))).toBe(false)
    expect(isContactFormDirty(c, { ...formFromContact(c), dislikes: 'Noise' })).toBe(true)
  })

  it('reports only the fields whose meaning changed', () => {
    const c = contact()
    const form = {
      ...formFromContact(c),
      name: ' Amélie ', // same after trimming
      interests: 'Jazz, hiking, chess',
      dislikes: '   ', // still empty
      education: '', // cleared
      birthday: '17/05/1990', // year added
    }
    expect(contactChanges(c, form)).toEqual({
      ok: true,
      changes: { interests: 'Jazz, hiking, chess', education: '', birthday: '1990-05-17' },
    })
  })

  it('refuses an invalid birthday before saving anything', () => {
    expect(contactChanges(contact(), { ...formFromContact(contact()), birthday: '32/01' })).toEqual({ ok: false, message: birthdayInputMessage() })
  })

  it('builds a new contact from the form', () => {
    expect(newContactInput({ ...EMPTY_CONTACT_FORM, name: 'Bob', birthday: '01/02' })).toEqual({
      ok: true,
      input: { name: 'Bob', description: '', education: '', address: '', birthday: '--02-01', interests: '', dislikes: '' },
    })
    expect(newContactInput({ ...EMPTY_CONTACT_FORM, name: 'Bob', birthday: 'soon' }).ok).toBe(false)
  })
})

describe('interaction time', () => {
  it('converts a local Paris time to UTC (winter, UTC+1)', () => {
    expect(interactionTimeFromFields('12/11/2026', '14:30', 'Europe/Paris')).toEqual({ ok: true, occurredStart: '2026-11-12T13:30:00.000Z', ambiguous: false })
  })

  it('summer time (UTC+2) and another timezone', () => {
    expect(interactionTimeFromFields('01/07/2026', '09:00', 'Europe/Paris')).toEqual({ ok: true, occurredStart: '2026-07-01T07:00:00.000Z', ambiguous: false })
    expect(interactionTimeFromFields('01/07/2026', '09:00', 'America/New_York')).toEqual({ ok: true, occurredStart: '2026-07-01T13:00:00.000Z', ambiguous: false })
  })

  it('refuses a time skipped when clocks move forward (29/03/2026 02:30 in Paris)', () => {
    const result = interactionTimeFromFields('29/03/2026', '02:30', 'Europe/Paris')
    expect(result.ok).toBe(false)
  })

  it('flags a time that occurs twice when clocks go back (25/10/2026 02:30 in Paris) and uses the first', () => {
    expect(interactionTimeFromFields('25/10/2026', '02:30', 'Europe/Paris')).toEqual({ ok: true, occurredStart: '2026-10-25T00:30:00.000Z', ambiguous: true })
  })

  it('refuses badly typed fields', () => {
    expect(interactionTimeFromFields('2026-11-12', '14:30', 'Europe/Paris').ok).toBe(false)
    expect(interactionTimeFromFields('12/11/2026', '2pm', 'Europe/Paris').ok).toBe(false)
  })

  it('shows an instant in the fields of a timezone', () => {
    expect(fieldsFromInstant('2026-11-12T13:30:00.000Z', 'Europe/Paris')).toEqual({ date: '12/11/2026', time: '14:30' })
    expect(fieldsFromInstant('2026-11-12T13:30:00.000Z', 'Asia/Tokyo')).toEqual({ date: '12/11/2026', time: '22:30' })
  })
})
