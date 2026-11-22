/**
 * End-to-end encryption for synchronisation (docs/SYNC_DESIGN.md §3).
 *
 * Uses only the browser's Web Crypto API.
 *
 * - Data key: one random AES-GCM 256-bit key per user; every record is
 *   encrypted with it.
 * - Passphrase key: PBKDF2-SHA-256 (default 600,000 iterations, random
 *   16-byte salt) → AES-KW key that wraps the data key.
 * - Recovery key: 16 random bytes → HKDF-SHA-256 → AES-KW key that wraps
 *   the data key a second time. (The recovery key is fully random, so it
 *   needs no slow derivation and no salt; using none lets the passphrase
 *   and its salt change without touching the recovery wrapping.)
 * - AES-KW includes an integrity check: a wrong passphrase or recovery key,
 *   or a modified wrapped key, is detected when unwrapping.
 * - Records: AES-GCM with a fresh random 12-byte IV per encryption. The
 *   authenticated data binds each ciphertext to its owner, collection,
 *   record id, revision and key version, so the server cannot swap,
 *   move or replay records without detection.
 *
 * Unwrapped data keys are always non-extractable: the page can use them,
 * but their bytes can never be read back out.
 *
 * Expected failures (wrong passphrase, tampered data) are returned as a
 * status; programming errors (for example an unchecked passphrase) throw.
 */

import { checkPassphrase, normalizePassphrase } from './passphrase'
import { formatRecoveryKey, parseRecoveryKey, RECOVERY_KEY_BYTES } from './recoveryKey'
import type { SyncCollection } from './types'

export const DEFAULT_PBKDF2_ITERATIONS = 600_000
/** Same lower bound as the user_keys.iterations check on the server. */
export const MIN_PBKDF2_ITERATIONS = 100_000
/** Refuse absurd counts from a corrupted or hostile key envelope. */
export const MAX_PBKDF2_ITERATIONS = 10_000_000
export const CURRENT_KEY_VERSION = 1
/** Same limit as the sync_records.ciphertext check on the server. */
export const MAX_CIPHERTEXT_BYTES = 1024 * 1024

const SALT_BYTES = 16
const IV_BYTES = 12
const GCM_TAG_BYTES = 16
/** AES-KW output for a 256-bit key: 32 bytes + 8-byte integrity block. */
const WRAPPED_KEY_BYTES = 40
const RECOVERY_HKDF_INFO = new TextEncoder().encode('personal-data-analyst sync recovery key v1')
const RECORD_AAD_LABEL = 'personal-data-analyst sync record'
const RECORD_AAD_FORMAT = 1

type Bytes = Uint8Array<ArrayBuffer>

/** What the server stores in user_keys (wrapped keys only, never the data key). */
export interface KeyEnvelope {
  wrappedKeyPass: Bytes
  wrappedKeyRec: Bytes
  salt: Bytes
  iterations: number
  keyVersion: number
}

export interface CreatedKeys {
  /** Non-extractable data key for this device. */
  dataKey: CryptoKey
  /** To upload to user_keys. */
  envelope: KeyEnvelope
  /** Shown to the user once, to print or store safely. Never uploaded. */
  recoveryKey: string
}

export type Secret =
  | { kind: 'passphrase'; passphrase: string }
  | { kind: 'recoveryKey'; recoveryKey: string }

export type UnlockResult =
  | { status: 'ok'; dataKey: CryptoKey }
  /** Passphrase or recovery key is well-formed but does not open the key. */
  | { status: 'wrong-secret' }
  /** The recovery key text has a typo or the wrong length/characters. */
  | { status: 'invalid-recovery-key'; reason: 'length' | 'character' | 'checksum' }
  /** The stored envelope is malformed (corrupted or not from this app). */
  | { status: 'invalid-envelope'; reason: string }

export type ChangePassphraseResult =
  | { status: 'ok'; envelope: KeyEnvelope }
  | Exclude<UnlockResult, { status: 'ok' }>

export interface RecordContext {
  /** Supabase user id of the owner. */
  userId: string
  collection: SyncCollection
  recordId: string
  revision: number
  keyVersion: number
}

export type EncryptResult =
  | { status: 'ok'; ciphertext: Bytes; iv: Bytes }
  | { status: 'too-large'; bytes: number; maximum: number }

export type DecryptResult =
  | { status: 'ok'; record: unknown }
  /** Wrong key, modified data, or data belonging to another record/user/revision. */
  | { status: 'unreadable' }
  /** Decrypted correctly but is not JSON (should never happen with this app). */
  | { status: 'invalid-json' }

function randomBytes(length: number): Bytes {
  return crypto.getRandomValues(new Uint8Array(length))
}

async function passphraseKek(passphrase: string, salt: Bytes, iterations: number): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(normalizePassphrase(passphrase)),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    material,
    { name: 'AES-KW', length: 256 },
    false,
    ['wrapKey', 'unwrapKey'],
  )
}

async function recoveryKek(recoveryBytes: Bytes): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', recoveryBytes, 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: RECOVERY_HKDF_INFO },
    material,
    { name: 'AES-KW', length: 256 },
    false,
    ['wrapKey', 'unwrapKey'],
  )
}

async function wrap(dataKey: CryptoKey, kek: CryptoKey): Promise<Bytes> {
  return new Uint8Array(await crypto.subtle.wrapKey('raw', dataKey, kek, 'AES-KW'))
}

async function unwrap(wrapped: Bytes, kek: CryptoKey, extractable: boolean): Promise<CryptoKey | null> {
  try {
    return await crypto.subtle.unwrapKey(
      'raw',
      wrapped,
      kek,
      'AES-KW',
      { name: 'AES-GCM', length: 256 },
      extractable,
      ['encrypt', 'decrypt'],
    )
  } catch {
    // AES-KW integrity check failed: wrong secret or modified wrapped key.
    return null
  }
}

function requireValidPassphrase(passphrase: string): void {
  const check = checkPassphrase(passphrase)
  if (check.status !== 'ok') {
    throw new RangeError(`Passphrase must be at least ${check.minimum} characters (check it first)`)
  }
}

function requireIterations(iterations: number): void {
  if (
    !Number.isInteger(iterations) ||
    iterations < MIN_PBKDF2_ITERATIONS ||
    iterations > MAX_PBKDF2_ITERATIONS
  ) {
    throw new RangeError(`PBKDF2 iterations must be an integer from ${MIN_PBKDF2_ITERATIONS} to ${MAX_PBKDF2_ITERATIONS}`)
  }
}

/** Checks the shape of an envelope received from the server. */
export function checkEnvelope(envelope: KeyEnvelope): { status: 'ok' } | { status: 'invalid-envelope'; reason: string } {
  const invalid = (reason: string) => ({ status: 'invalid-envelope' as const, reason })
  if (envelope.salt.length !== SALT_BYTES) return invalid('salt length')
  if (envelope.wrappedKeyPass.length !== WRAPPED_KEY_BYTES) return invalid('passphrase-wrapped key length')
  if (envelope.wrappedKeyRec.length !== WRAPPED_KEY_BYTES) return invalid('recovery-wrapped key length')
  if (
    !Number.isInteger(envelope.iterations) ||
    envelope.iterations < MIN_PBKDF2_ITERATIONS ||
    envelope.iterations > MAX_PBKDF2_ITERATIONS
  ) {
    return invalid('iteration count')
  }
  if (!Number.isInteger(envelope.keyVersion) || envelope.keyVersion < 1) return invalid('key version')
  return { status: 'ok' }
}

/**
 * First device: creates the data key, wraps it with the passphrase and a
 * new recovery key. The passphrase must already pass checkPassphrase().
 */
export async function createKeys(
  passphrase: string,
  options: { iterations?: number } = {},
): Promise<CreatedKeys> {
  requireValidPassphrase(passphrase)
  const iterations = options.iterations ?? DEFAULT_PBKDF2_ITERATIONS
  requireIterations(iterations)

  // Extractable only for the time needed to wrap it.
  const extractableKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
    'encrypt',
    'decrypt',
  ])
  const salt = randomBytes(SALT_BYTES)
  const recoveryBytes = randomBytes(RECOVERY_KEY_BYTES)

  const wrappedKeyPass = await wrap(extractableKey, await passphraseKek(passphrase, salt, iterations))
  const recKek = await recoveryKek(recoveryBytes)
  const wrappedKeyRec = await wrap(extractableKey, recKek)

  // Re-import as non-extractable for use on this device.
  const dataKey = await unwrap(wrappedKeyRec, recKek, false)
  if (!dataKey) throw new Error('Could not unwrap a freshly wrapped data key')

  return {
    dataKey,
    envelope: { wrappedKeyPass, wrappedKeyRec, salt, iterations, keyVersion: CURRENT_KEY_VERSION },
    recoveryKey: formatRecoveryKey(recoveryBytes),
  }
}

async function unlock(envelope: KeyEnvelope, secret: Secret, extractable: boolean): Promise<UnlockResult> {
  const envelopeCheck = checkEnvelope(envelope)
  if (envelopeCheck.status !== 'ok') return envelopeCheck

  let key: CryptoKey | null
  if (secret.kind === 'passphrase') {
    const kek = await passphraseKek(secret.passphrase, envelope.salt, envelope.iterations)
    key = await unwrap(envelope.wrappedKeyPass, kek, extractable)
  } else {
    const parsed = parseRecoveryKey(secret.recoveryKey)
    if (parsed.status !== 'ok') return { status: 'invalid-recovery-key', reason: parsed.reason }
    key = await unwrap(envelope.wrappedKeyRec, await recoveryKek(parsed.bytes), extractable)
  }
  return key ? { status: 'ok', dataKey: key } : { status: 'wrong-secret' }
}

/** Another device: opens the data key with the passphrase or recovery key. */
export function unlockDataKey(envelope: KeyEnvelope, secret: Secret): Promise<UnlockResult> {
  return unlock(envelope, secret, false)
}

/**
 * Sets a new passphrase (also used after "forgot passphrase" with the
 * recovery key). Only the passphrase wrapping and salt change; the data
 * key, the recovery wrapping and all encrypted records stay the same.
 */
export async function changePassphrase(
  envelope: KeyEnvelope,
  current: Secret,
  newPassphrase: string,
  options: { iterations?: number } = {},
): Promise<ChangePassphraseResult> {
  requireValidPassphrase(newPassphrase)
  const iterations = options.iterations ?? DEFAULT_PBKDF2_ITERATIONS
  requireIterations(iterations)

  const opened = await unlock(envelope, current, true)
  if (opened.status !== 'ok') return opened

  const salt = randomBytes(SALT_BYTES)
  const wrappedKeyPass = await wrap(opened.dataKey, await passphraseKek(newPassphrase, salt, iterations))
  return {
    status: 'ok',
    envelope: { ...envelope, wrappedKeyPass, salt, iterations },
  }
}

/** Authenticated data binding a ciphertext to exactly one record version. */
export function recordAad(context: RecordContext): Bytes {
  return new TextEncoder().encode(
    JSON.stringify([
      RECORD_AAD_LABEL,
      RECORD_AAD_FORMAT,
      context.userId,
      context.collection,
      context.recordId,
      context.revision,
      context.keyVersion,
    ]),
  )
}

/** Encrypts one record (as JSON) for upload. */
export async function encryptRecord(
  dataKey: CryptoKey,
  context: RecordContext,
  record: unknown,
): Promise<EncryptResult> {
  const plaintext = new TextEncoder().encode(JSON.stringify(record))
  const bytes = plaintext.length + GCM_TAG_BYTES
  if (bytes > MAX_CIPHERTEXT_BYTES) {
    return { status: 'too-large', bytes, maximum: MAX_CIPHERTEXT_BYTES }
  }
  const iv = randomBytes(IV_BYTES)
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: recordAad(context) }, dataKey, plaintext),
  )
  return { status: 'ok', ciphertext, iv }
}

/**
 * Decrypts one downloaded record. The result is unvalidated JSON: callers
 * must validate it with the same rules as local data before using it.
 */
export async function decryptRecord(
  dataKey: CryptoKey,
  context: RecordContext,
  ciphertext: Bytes,
  iv: Bytes,
): Promise<DecryptResult> {
  if (iv.length !== IV_BYTES) return { status: 'unreadable' }
  let plaintext: ArrayBuffer
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: recordAad(context) },
      dataKey,
      ciphertext,
    )
  } catch {
    return { status: 'unreadable' }
  }
  try {
    return { status: 'ok', record: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plaintext)) }
  } catch {
    return { status: 'invalid-json' }
  }
}
