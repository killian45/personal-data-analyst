import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createContact, deleteContact } from '../database/contacts'
import { db } from '../database/db'

import {
  applyPhoneContactImport,
  candidateSummary,
  formatPhoneAddresses,
  mapPhoneContact,
  parsePhoneBirthday,
  planPhoneContactImport,
  readPhoneContactList,
} from './phoneContactImport'
import type { PhoneContact } from './phoneContactImport'

function phone(lookupKey: string, name: string | null, changes: Partial<PhoneContact> = {}): PhoneContact {
  return { lookupKey, name, addresses: [], birthdays: [], notes: [], ...changes }
}

beforeEach(async () => {
  await db.delete()
  await db.open()
})

afterEach(async () => {
  vi.restoreAllMocks()
  db.close()
  await db.delete()
})

describe('readPhoneContactList (data from the plugin is checked)', () => {
  it('keeps well-formed contacts and ignores the rest', () => {
    expect(readPhoneContactList([
      { lookupKey: 'k1', name: 'Bob', addresses: [{ formatted: 'Lyon', type: 1, label: null }, { type: 2 }], birthdays: ['1990-05-17', 7], notes: ['Met in Paris'] },
      { lookupKey: '', name: 'No key' },
      { name: 'Missing key' },
      'garbage',
      { lookupKey: 'k2' },
    ])).toEqual([
      { lookupKey: 'k1', name: 'Bob', addresses: [{ formatted: 'Lyon', type: 1, label: null }], birthdays: ['1990-05-17'], notes: ['Met in Paris'] },
      { lookupKey: 'k2', name: null, addresses: [], birthdays: [], notes: [] },
    ])
  })
})

describe('parsePhoneBirthday', () => {
  it('reads the formats phones use', () => {
    expect(parsePhoneBirthday('1990-05-17')).toBe('1990-05-17')
    expect(parsePhoneBirthday('--05-17')).toBe('--05-17')
    expect(parsePhoneBirthday('--0517')).toBe('--05-17')
    expect(parsePhoneBirthday('19900517')).toBe('1990-05-17')
    expect(parsePhoneBirthday('1990-05-17T00:00:00Z')).toBe('1990-05-17')
    expect(parsePhoneBirthday('1990-05-17T00:00:00.000+02:00')).toBe('1990-05-17')
    expect(parsePhoneBirthday('17.05.1990')).toBe('1990-05-17')
    expect(parsePhoneBirthday(' 7.5.1990 ')).toBe('1990-05-07')
  })

  it('refuses ambiguous, impossible or unknown formats', () => {
    expect(parsePhoneBirthday('05/06/1990')).toBeNull() // 5 June or May 6?
    expect(parsePhoneBirthday('1990-02-30')).toBeNull()
    expect(parsePhoneBirthday('--02-30')).toBeNull()
    expect(parsePhoneBirthday('May 17')).toBeNull()
    expect(parsePhoneBirthday('')).toBeNull()
  })

  it('29 February: kept without a year, refused in a non-leap year', () => {
    expect(parsePhoneBirthday('--02-29')).toBe('--02-29')
    expect(parsePhoneBirthday('2023-02-29')).toBeNull()
  })
})

describe('formatPhoneAddresses', () => {
  it('one address as is; several with their labels', () => {
    expect(formatPhoneAddresses([{ formatted: ' 12 rue X\n75011 Paris ', type: 1, label: null }])).toBe('12 rue X\n75011 Paris')
    expect(formatPhoneAddresses([
      { formatted: 'Lyon', type: 1, label: null },
      { formatted: 'Office, Paris', type: 2, label: null },
      { formatted: 'Chalet', type: 0, label: 'Holidays' },
      { formatted: 'Somewhere', type: 0, label: null },
      { formatted: '  ', type: 3, label: null },
    ])).toBe('Home: Lyon\n\nWork: Office, Paris\n\nHolidays: Chalet\n\nAddress: Somewhere')
    expect(formatPhoneAddresses([])).toBeNull()
  })
})

describe('mapPhoneContact', () => {
  it('maps name, addresses, first readable birthday and notes, and lists what was left out', () => {
    expect(mapPhoneContact(phone('k1', ' Amélie ', {
      addresses: [{ formatted: 'Lyon', type: 1, label: null }],
      birthdays: ['17/05/1990', '--05-17'],
      notes: ['Met at university', '  ', 'Likes jazz'],
    }))).toEqual({
      input: { name: 'Amélie', externalPhoneId: 'k1', address: 'Lyon', description: 'Met at university\n\nLikes jazz', birthday: '--05-17' },
      notes: ['birthday "17/05/1990" could not be read: not imported'],
    })
  })

  it('a note over the limit is left out and listed, the contact still imports', () => {
    const { input, notes } = mapPhoneContact(phone('k1', 'Bob', { notes: ['x'.repeat(5001)] }))
    expect(input.description).toBeUndefined()
    expect(notes).toEqual(['Note longer than 5,000 characters: not imported'])
  })

  it('a contact without a name cannot be imported', () => {
    expect(() => mapPhoneContact(phone('k1', null))).toThrow('Name is required.')
    expect(() => mapPhoneContact(phone('k1', '   '))).toThrow('Name is required.')
  })
})

describe('planPhoneContactImport', () => {
  it('sorts phone contacts into new, already imported, changed, deleted and not importable', async () => {
    const same = await createContact({ name: 'Same', address: 'Lyon', externalPhoneId: 'k-same' })
    await createContact({ name: 'Changed', address: 'Old address', externalPhoneId: 'k-changed' })
    const deleted = await createContact({ name: 'Gone', externalPhoneId: 'k-gone' })
    await deleteContact(deleted.id)
    await createContact({ name: 'Émile' }) // created by hand
    const existing = await db.contacts.toArray()

    const plan = planPhoneContactImport([
      phone('k-same', 'Same', { addresses: [{ formatted: 'Lyon', type: 1, label: null }] }),
      phone('k-changed', 'Changed', { addresses: [{ formatted: 'New address', type: 1, label: null }], birthdays: ['--01-02'] }),
      phone('k-gone', 'Gone'),
      phone('k-new', 'Bob'),
      phone('k-emile', 'emile'),
      phone('k-noname', null),
      phone('k-new', 'Bob again (same key)'),
    ], existing)

    expect(plan.found).toBe(6)
    expect(plan.candidates.map((c) => [c.input.name, c.sameNameAsExisting])).toEqual([['Bob', false], ['emile', true]])
    expect(plan.alreadyImported).toEqual([{ name: 'Same', reason: 'already imported' }])
    expect(plan.changedOnPhone).toEqual([{ name: 'Changed', reason: 'differs from the phone (address, birthday); the version in PDA was kept' }])
    expect(plan.deletedInPda).toEqual([{ name: 'Gone', reason: expect.stringContaining('Deleted data') }])
    expect(plan.notImportable).toEqual([{ name: '(no name)', reason: 'Name is required.' }])
    // Nothing was written.
    expect(await db.contacts.get(same.id)).toEqual(same)
    expect(await db.contacts.count()).toBe(4)
  })

  it('summarises a candidate for the list', () => {
    const [candidate] = planPhoneContactImport([phone('k', 'Bob', {
      birthdays: ['1990-05-17'], addresses: [{ formatted: '12 rue X\nParis', type: 1, label: null }], notes: ['n'],
    })], []).candidates
    expect(candidateSummary(candidate)).toBe('Birthday 17/05/1990 · 12 rue X · note')
  })
})

describe('applyPhoneContactImport', () => {
  it('saves the chosen contacts with their phone key, pending sync', async () => {
    const plan = planPhoneContactImport([phone('k1', 'Bob', { birthdays: ['--05-17'] }), phone('k2', 'Alice')], [])
    expect(await applyPhoneContactImport([plan.candidates[0]])).toBe(1)
    const stored = await db.contacts.toArray()
    expect(stored).toEqual([expect.objectContaining({ name: 'Bob', birthday: '--05-17', externalPhoneId: 'k1', syncStatus: 'pending', revision: 1 })])
  })

  it('saves nothing if one of the chosen contacts was imported meanwhile', async () => {
    const plan = planPhoneContactImport([phone('k1', 'Bob'), phone('k2', 'Alice')], [])
    await createContact({ name: 'Alice', externalPhoneId: 'k2' }) // e.g. imported in another tab
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(applyPhoneContactImport(plan.candidates)).rejects.toThrow('Nothing was imported')
    expect((await db.contacts.toArray()).map((c) => c.name)).toEqual(['Alice'])
  })
})
