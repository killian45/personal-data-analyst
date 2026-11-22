import { describe, expect, it } from 'vitest'

import { parseCsv } from './csv'

describe('parseCsv', () => {
  it('reads simple rows and keeps empty lines as [""]', () => {
    expect(parseCsv('a,b,c\n1,2,3\n\nx,y\n')).toEqual([['a', 'b', 'c'], ['1', '2', '3'], [''], ['x', 'y']])
  })

  it('handles quotes, escaped quotes, commas and line breaks inside quotes', () => {
    expect(parseCsv('"Maps, offline","say ""hi""","two\nlines"\r\nend')).toEqual([
      ['Maps, offline', 'say "hi"', 'two\nlines'],
      ['end'],
    ])
  })

  it('ignores a byte-order mark and accepts CRLF and a missing final line break', () => {
    expect(parseCsv('\ufeffA,B\r\n1,2')).toEqual([['A', 'B'], ['1', '2']])
  })

  it('supports another delimiter', () => {
    expect(parseCsv('a\t"b"\n')).toEqual([['a\t"b"']])
    expect(parseCsv('a\t"b"\n', '\t')).toEqual([['a', 'b']])
  })

  it('returns no rows for an empty text', () => {
    expect(parseCsv('')).toEqual([])
  })

  it('rejects a file that ends inside quotes', () => {
    expect(() => parseCsv('a,"unfinished')).toThrow(/inside a quoted field/)
  })
})
