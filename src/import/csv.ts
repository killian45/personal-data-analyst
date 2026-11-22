import { messages } from '../i18n'
/**
 * Minimal CSV reader (RFC 4180): fields separated by a delimiter, optional
 * double quotes, "" for a quote inside a quoted field, line breaks inside
 * quotes kept. Lines end with \n or \r\n. A leading byte-order mark is
 * ignored. Pure, no dependencies.
 *
 * An empty line gives a row with one empty field ([""]), so callers can
 * see section breaks.
 */
export function parseCsv(text: string, delimiter = ','): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0

  for (; i < text.length; i += 1) {
    const char = text[i]

    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 1
        } else {
          quoted = false
        }
      } else {
        field += char
      }
    } else if (char === '"' && field === '') {
      quoted = true
    } else if (char === delimiter) {
      row.push(field)
      field = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i += 1
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += char
    }
  }

  if (quoted) {
    throw new Error(messages().importText.csvUnclosed)
  }

  // Last line without a final line break.
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  return rows
}
