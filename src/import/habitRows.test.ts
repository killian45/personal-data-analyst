import { describe, expect, it } from 'vitest'

import type { Entry, Habit } from '../database/types'

import { columnNames, detectDelimiter, markDuplicates, parseCheckbox, parseDate, parseNumber, parseTime, prepareRows, readTable, summarize } from './habitRows'
import type { ImportMapping, ImportOptions } from './habitRows'

// Paris: UTC+1 in winter, UTC+2 in summer. 2026 clock changes: forward 29/03 02:00→03:00, back 25/10 03:00→02:00.
const OPTIONS: ImportOptions = { order: 'dmy', timezone: 'Europe/Paris', firstRowIsHeader: true, nextDayIfEarlier: true }

const habit = (type: Habit['type'], extra: Partial<Habit> = {}): Habit => ({
  id: 'h1', name: 'Test', type, unit: null, labelOptions: type === 'label' ? ['Calm', 'Tense'] : null,
  ...(type === 'number' ? { dailyAggregation: 'sum', target: null } : {}), ...extra,
} as Habit)

describe('reading the table', () => {
  it('finds the separator: tab for pasted cells, semicolon or comma for CSV files', () => {
    expect(detectDelimiter('Date\tDose\n13/11/2026\t5')).toBe('\t')
    expect(detectDelimiter('Date;Dose;Note\n13/11/2026;2,5;x')).toBe(';')
    expect(detectDelimiter('Date,Dose\n13/11/2026,5')).toBe(',')
  })

  it('drops empty lines at the end and names columns by header and letter', () => {
    const table = readTable('Start;Stop\n13/11/2026 22:00;23:00\n;\n\n')
    expect(table).toEqual([['Start', 'Stop'], ['13/11/2026 22:00', '23:00']])
    expect(columnNames(table, true)).toEqual(['Start (column A)', 'Stop (column B)'])
    expect(columnNames(table, false)).toEqual(['Column A', 'Column B'])
  })
})

describe('cells', () => {
  it('reads dates in the chosen order and refuses impossible ones', () => {
    expect(parseDate('13/11/2026', 'dmy')).toBe('2026-11-13')
    expect(parseDate('13.11.26', 'dmy')).toBe('2026-11-13')
    expect(parseDate('11/13/2026', 'mdy')).toBe('2026-11-13')
    expect(parseDate('2026-11-13', 'ymd')).toBe('2026-11-13')
    expect(parseDate('11/13/2026', 'dmy')).toBeNull() // month 13
    expect(parseDate('31/04/2026', 'dmy')).toBeNull() // 31 April
    expect(parseDate('29/02/2026', 'dmy')).toBeNull() // not a leap year
    expect(parseDate('yesterday', 'dmy')).toBeNull()
  })

  it('reads times in 24-hour and am/pm forms', () => {
    expect(parseTime('22:15')).toBe('22:15:00')
    expect(parseTime('7:05')).toBe('07:05:00')
    expect(parseTime('22:15:30')).toBe('22:15:30')
    expect(parseTime('22h15')).toBe('22:15:00')
    expect(parseTime('9:05 pm')).toBe('21:05:00')
    expect(parseTime('12 am')).toBe('00:00:00')
    expect(parseTime('24:00')).toBeNull()
    expect(parseTime('22')).toBeNull() // a bare number is not a time
  })

  it('reads numbers with a decimal point or comma and an optional unit; flags thousands-like numbers', () => {
    expect(parseNumber('2,5')).toBe(2.5)
    expect(parseNumber('2.5')).toBe(2.5)
    expect(parseNumber('50 mg')).toBe(50)
    expect(parseNumber('0.125')).toBe(0.125)
    expect(parseNumber('1000')).toBe(1000)
    expect(parseNumber('1,000')).toBe('ambiguous')
    expect(parseNumber('2.500')).toBe('ambiguous')
    expect(parseNumber('ten')).toBeNull()
    expect(parseCheckbox('Yes')).toBe(true)
    expect(parseCheckbox('x')).toBe(true)
    expect(parseCheckbox('0')).toBe(false)
    expect(parseCheckbox('maybe')).toBeNull()
  })
})

describe('prepareRows (hand-calculated, Europe/Paris)', () => {
  it('stopwatch: start and stop on one date, past midnight = next day; separate date and time columns', () => {
    const table = [
      ['Date', 'Start', 'Stop', 'Note'],
      ['13/11/2026', '23:30', '00:45', 'late'], // 22:30Z → 23:45Z (stop on 14/11)
      ['01/07/2026', '08:00', '09:15', ''], // summer: 06:00Z → 07:15Z
      ['', '', '', ''], // empty row (another habit's row)
      ['02/07/2026', '08:00', '', ''], // stop missing
    ]
    const mapping: ImportMapping = { type: 'stopwatch', start: { date: 0, time: 1 }, end: { date: 0, time: 2 }, comment: 3 }
    const results = prepareRows(table, habit('stopwatch'), mapping, OPTIONS)
    expect(results[0]).toMatchObject({ kind: 'ready', item: { row: 2, occurredStart: '2026-11-13T22:30:00.000Z', occurredEnd: '2026-11-13T23:45:00.000Z', comment: 'late', localEnd: '2026-11-14T00:45:00' } })
    expect(results[1]).toMatchObject({ kind: 'ready', item: { occurredStart: '2026-07-01T06:00:00.000Z', occurredEnd: '2026-07-01T07:15:00.000Z', comment: null } })
    expect(results[2]).toEqual({ kind: 'empty', row: 4 })
    expect(results[3]).toEqual({ kind: 'problem', row: 5, message: 'Stop: a time is needed for a stopwatch.' })
    // Without "next day", a stop before the start is a problem.
    expect(prepareRows(table.slice(0, 2), habit('stopwatch'), mapping, { ...OPTIONS, nextDayIfEarlier: false })[0]).toEqual({ kind: 'problem', row: 2, message: 'The stop is not after the start.' })
  })

  it('stopwatch: combined date-time cells; clock changes are never guessed', () => {
    const table = [
      ['Start', 'Stop'],
      ['29/03/2026 02:30', '29/03/2026 04:00'], // 02:30 does not exist (clocks forward)
      ['25/10/2026 02:30', '25/10/2026 04:00'], // 02:30 happens twice: first (UTC+2) = 00:30Z; 04:00 (UTC+1) = 03:00Z
      ['14/11/2026', '14/11/2026 10:00'], // start has no time
    ]
    const mapping: ImportMapping = { type: 'stopwatch', start: { date: 0, time: null }, end: { date: 1, time: null }, comment: null }
    const [gap, twice, noTime] = prepareRows(table, habit('stopwatch'), mapping, OPTIONS)
    expect(gap).toMatchObject({ kind: 'problem', row: 2 })
    expect((gap as { message: string }).message).toContain('does not exist')
    expect(twice).toMatchObject({ kind: 'ready', item: { occurredStart: '2026-10-25T00:30:00.000Z', occurredEnd: '2026-10-25T03:00:00.000Z', ambiguous: true } })
    expect(noTime).toEqual({ kind: 'problem', row: 4, message: 'Start: a time is needed for a stopwatch.' })
  })

  it('number (medication dose), checkbox, category and text rows; a date without time = 12:00', () => {
    const table = [['When', 'Dose', 'Done', 'Mood', 'Note'], ['13/11/2026 08:00', '2,5 mg', 'yes', 'calm', 'ok'], ['14/11/2026', '1,000', 'no', 'Angry', '']]
    const when = { date: 0, time: null }
    const number = prepareRows(table, habit('number'), { type: 'number', value: 1, when, comment: 4 }, OPTIONS)
    expect(number[0]).toMatchObject({ kind: 'ready', item: { value: 2.5, occurredStart: '2026-11-13T07:00:00.000Z', occurredEnd: null, comment: 'ok' } })
    expect(number[1]).toMatchObject({ kind: 'problem', row: 3 })
    expect((number[1] as { message: string }).message).toContain('ambiguous')

    const checkbox = prepareRows(table, habit('checkbox'), { type: 'checkbox', value: 2, when, comment: null }, OPTIONS)
    expect(checkbox.map((r) => r.kind === 'ready' && r.item.value)).toEqual([true, false])
    // 14/11 without a time → 12:00 Paris = 11:00Z.
    expect(checkbox[1]).toMatchObject({ item: { occurredStart: '2026-11-14T11:00:00.000Z', localStart: '2026-11-14T12:00:00' } })

    const label = prepareRows(table, habit('label'), { type: 'label', value: 3, when, comment: null }, OPTIONS)
    expect(label[0]).toMatchObject({ kind: 'ready', item: { value: 'Calm' } }) // matched without case
    expect(label[1]).toMatchObject({ kind: 'problem', row: 3 })
    expect((label[1] as { message: string }).message).toContain("not one of this habit's categories (Calm, Tense)")

    const text = prepareRows(table, habit('text'), { type: 'text', value: 4, when, comment: null }, OPTIONS)
    expect(text.map((r) => r.kind)).toEqual(['ready', 'problem']) // second row's text is empty
  })

  it('categories: several in one cell become one entry each at the same time; unknown ones are named', () => {
    const emotions = habit('label', { labelOptions: ['Love', 'Excitement', 'Pride', 'Calm, relaxed'] } as Partial<Habit>)
    const table = [['When', 'Feelings'], ['13/11/2026 08:00', 'Love, Excitement; pride'], ['13/11/2026 09:00', 'Calm, relaxed'], ['13/11/2026 10:00', 'Love, Joy, Awe'], ['13/11/2026 11:00', 'Love, love']]
    const results = prepareRows(table, emotions, { type: 'label', value: 1, when: { date: 0, time: null }, comment: null }, OPTIONS)
    expect(results.slice(0, 3).map((r) => r.kind === 'ready' && [r.item.row, r.item.part, r.item.value, r.item.occurredStart])).toEqual([
      [2, 1, 'Love', '2026-11-13T07:00:00.000Z'], [2, 2, 'Excitement', '2026-11-13T07:00:00.000Z'], [2, 3, 'Pride', '2026-11-13T07:00:00.000Z'],
    ])
    // A category that itself contains a comma is matched whole first.
    expect(results[3]).toMatchObject({ kind: 'ready', item: { row: 3, part: null, value: 'Calm, relaxed' } })
    expect(results[4]).toMatchObject({ kind: 'problem', row: 4 })
    expect((results[4] as { message: string }).message).toMatch(/^"Joy", "Awe" are not one of this habit's categories/)
    // The same category twice in a cell counts once.
    expect(results.slice(5).map((r) => r.kind === 'ready' && r.item.value)).toEqual(['Love'])
    expect(summarize(results)).toMatchObject({ ready: 5, problems: 1 })
  })

  it('month/day/year order changes the reading', () => {
    const table = [['When', 'Dose'], ['11/13/2026 08:00', '5']]
    expect(prepareRows(table, habit('number'), { type: 'number', value: 1, when: { date: 0, time: null }, comment: null }, { ...OPTIONS, order: 'mdy' })[0])
      .toMatchObject({ kind: 'ready', item: { occurredStart: '2026-11-13T07:00:00.000Z' } })
  })
})

describe('duplicates', () => {
  it('skips rows already in the app or repeated in the file, and counts everything', () => {
    const table = [['When', 'Dose'], ['13/11/2026 08:00', '5'], ['13/11/2026 08:00', '5'], ['13/11/2026 20:00', '5'], ['13/11/2026 21:00', 'x'], ['', '']]
    const prepared = prepareRows(table, habit('number'), { type: 'number', value: 1, when: { date: 0, time: null }, comment: null }, OPTIONS)
    const existing = [{ habitType: 'number', value: 5, occurredStart: '2026-11-13T19:00:00.000Z', occurredEnd: null, deletedAt: null }] as unknown as Entry[]
    const results = markDuplicates(prepared, { type: 'number' }, existing)
    expect(results.map((r) => (r.kind === 'duplicate' ? `duplicate-${r.within}` : r.kind))).toEqual(['ready', 'duplicate-file', 'duplicate-app', 'problem', 'empty'])
    expect(summarize(results)).toEqual({ ready: 1, duplicates: 2, empty: 1, problems: 1, ambiguous: 0 })
    // A deleted entry in the app does not count.
    expect(markDuplicates(prepared, { type: 'number' }, [{ ...existing[0], deletedAt: '2026-11-14T00:00:00.000Z' }])[2].kind).toBe('ready')
  })
})
