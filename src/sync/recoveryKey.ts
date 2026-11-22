/**
 * Recovery key text format (docs/SYNC_DESIGN.md §3).
 *
 * 16 random bytes (128 bits) are written as 26 characters of Crockford
 * base32, followed by 2 check characters, shown as 7 groups of 4:
 *
 *   XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXCC
 *
 * Crockford base32 leaves out I, L, O and U so the key is easy to copy by
 * hand. When reading a key back, lower case, spaces and hyphens are
 * accepted, O is read as 0 and I/L as 1.
 *
 * Check characters: the weighted sum Σ (position × value) of the 26 data
 * characters (positions 1–26), modulo the prime 1021, written as 2 base32
 * characters. Because 1021 is prime and larger than any weight or value
 * difference, every single-character mistake and every swap of two
 * different neighbouring data characters changes the check, so such typos
 * are reported as typos instead of "wrong key".
 */

export const RECOVERY_KEY_BYTES = 16

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const DATA_CHARS = 26
const CHECK_CHARS = 2
const TOTAL_CHARS = DATA_CHARS + CHECK_CHARS
const CHECK_MODULUS = 1021
const GROUP_SIZE = 4

export type RecoveryKeyParse =
  | { status: 'ok'; bytes: Uint8Array<ArrayBuffer> }
  | { status: 'invalid'; reason: 'length' | 'character' | 'checksum' }

function checksum(values: readonly number[]): number {
  let sum = 0
  values.forEach((value, index) => {
    sum += (index + 1) * value
  })
  return sum % CHECK_MODULUS
}

/** Formats 16 bytes as a grouped recovery key. */
export function formatRecoveryKey(bytes: Uint8Array): string {
  if (bytes.length !== RECOVERY_KEY_BYTES) {
    throw new RangeError(`A recovery key must be ${RECOVERY_KEY_BYTES} bytes`)
  }
  let n = 0n
  for (const byte of bytes) n = (n << 8n) | BigInt(byte)

  const values: number[] = []
  for (let i = DATA_CHARS - 1; i >= 0; i--) {
    values.push(Number((n >> BigInt(5 * i)) & 31n))
  }
  const check = checksum(values)
  values.push(Math.floor(check / 32), check % 32)

  const text = values.map((v) => ALPHABET[v]).join('')
  const groups: string[] = []
  for (let i = 0; i < TOTAL_CHARS; i += GROUP_SIZE) groups.push(text.slice(i, i + GROUP_SIZE))
  return groups.join('-')
}

function charValue(char: string): number {
  const mapped = char === 'O' ? '0' : char === 'I' || char === 'L' ? '1' : char
  return ALPHABET.indexOf(mapped)
}

/** Reads a recovery key typed or pasted by the user. */
export function parseRecoveryKey(text: string): RecoveryKeyParse {
  const compact = text.toUpperCase().replace(/[\s-]/g, '')
  if (compact.length !== TOTAL_CHARS) return { status: 'invalid', reason: 'length' }

  const values = [...compact].map(charValue)
  if (values.some((v) => v < 0)) return { status: 'invalid', reason: 'character' }

  const data = values.slice(0, DATA_CHARS)
  const check = values[DATA_CHARS] * 32 + values[DATA_CHARS + 1]
  if (checksum(data) !== check) return { status: 'invalid', reason: 'checksum' }

  let n = 0n
  for (const v of data) n = (n << 5n) | BigInt(v)
  // 26 characters hold 130 bits; a real key uses only 128.
  if (n >> 128n !== 0n) return { status: 'invalid', reason: 'checksum' }

  const bytes = new Uint8Array(RECOVERY_KEY_BYTES)
  for (let i = RECOVERY_KEY_BYTES - 1; i >= 0; i--) {
    bytes[i] = Number(n & 0xffn)
    n >>= 8n
  }
  return { status: 'ok', bytes }
}
