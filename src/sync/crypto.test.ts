// @vitest-environment node
// (Web Crypto's crypto.subtle comes from Node; jsdom does not provide it.)
import { describe, expect, it } from 'vitest'

import {
  changePassphrase,
  checkEnvelope,
  createKeys,
  DEFAULT_PBKDF2_ITERATIONS,
  decryptRecord,
  encryptRecord,
  MAX_CIPHERTEXT_BYTES,
  MIN_PBKDF2_ITERATIONS,
  recordAad,
  unlockDataKey,
  type KeyEnvelope,
  type RecordContext,
} from './crypto'
import { formatRecoveryKey } from './recoveryKey'

// The lowest allowed count keeps the tests fast; one test uses the default.
const FAST = { iterations: MIN_PBKDF2_ITERATIONS }
const PASSPHRASE = 'correct horse battery staple'

const context: RecordContext = {
  userId: '6f1c1d2e-0000-4000-8000-000000000001',
  collection: 'entries',
  recordId: '0b8c7a52-1d1e-4f0e-9a51-6f7b1c2d3e4f',
  revision: 3,
  keyVersion: 1,
}

const sampleRecord = {
  id: context.recordId,
  habitId: 'h-1',
  value: 7.5,
  comment: 'Été — très bien 😀',
  deletedAt: null,
  nested: { list: [1, 2, 3] },
}

async function encryptOk(key: CryptoKey, ctx: RecordContext, record: unknown) {
  const result = await encryptRecord(key, ctx, record)
  if (result.status !== 'ok') throw new Error(`encrypt returned ${result.status}`)
  return result
}

async function expectSameKey(a: CryptoKey, b: CryptoKey) {
  const { ciphertext, iv } = await encryptOk(a, context, sampleRecord)
  expect(await decryptRecord(b, context, ciphertext, iv)).toEqual({ status: 'ok', record: sampleRecord })
}

function flipBit(bytes: Uint8Array<ArrayBuffer>, index = 0): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes)
  copy[index] ^= 0x01
  return copy
}

describe('createKeys', () => {
  it('creates an envelope with the expected sizes and the default 600,000 iterations', async () => {
    const created = await createKeys(PASSPHRASE)
    expect(DEFAULT_PBKDF2_ITERATIONS).toBe(600_000)
    expect(created.envelope.iterations).toBe(600_000)
    expect(created.envelope.keyVersion).toBe(1)
    expect(created.envelope.salt).toHaveLength(16)
    expect(created.envelope.wrappedKeyPass).toHaveLength(40)
    expect(created.envelope.wrappedKeyRec).toHaveLength(40)
    expect(checkEnvelope(created.envelope)).toEqual({ status: 'ok' })
    expect(created.recoveryKey).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){6}$/)
  })

  it('returns a data key whose bytes cannot be read', async () => {
    const { dataKey } = await createKeys(PASSPHRASE, FAST)
    expect(dataKey.extractable).toBe(false)
    expect(dataKey.algorithm).toMatchObject({ name: 'AES-GCM', length: 256 })
    expect([...dataKey.usages].sort()).toEqual(['decrypt', 'encrypt'])
    await expect(crypto.subtle.exportKey('raw', dataKey)).rejects.toThrow()
  })

  it('creates different keys, salts and recovery keys each time', async () => {
    const a = await createKeys(PASSPHRASE, FAST)
    const b = await createKeys(PASSPHRASE, FAST)
    expect(a.envelope.salt).not.toEqual(b.envelope.salt)
    expect(a.recoveryKey).not.toBe(b.recoveryKey)
    const { ciphertext, iv } = await encryptOk(a.dataKey, context, sampleRecord)
    expect(await decryptRecord(b.dataKey, context, ciphertext, iv)).toEqual({ status: 'unreadable' })
  })

  it('refuses a passphrase shorter than 12 characters and unsafe iteration counts', async () => {
    await expect(createKeys('too short', FAST)).rejects.toThrow(RangeError)
    await expect(createKeys(PASSPHRASE, { iterations: 1000 })).rejects.toThrow(RangeError)
    await expect(createKeys(PASSPHRASE, { iterations: 100_000.5 })).rejects.toThrow(RangeError)
  })
})

describe('unlockDataKey', () => {
  it('opens the same data key with the passphrase, as a non-extractable key', async () => {
    const created = await createKeys(PASSPHRASE, FAST)
    const result = await unlockDataKey(created.envelope, { kind: 'passphrase', passphrase: PASSPHRASE })
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.dataKey.extractable).toBe(false)
    await expectSameKey(created.dataKey, result.dataKey)
  })

  it('opens the same data key with the recovery key, however it is typed', async () => {
    const created = await createKeys(PASSPHRASE, FAST)
    for (const typed of [created.recoveryKey, created.recoveryKey.toLowerCase().replace(/-/g, ' ')]) {
      const result = await unlockDataKey(created.envelope, { kind: 'recoveryKey', recoveryKey: typed })
      expect(result.status).toBe('ok')
      if (result.status === 'ok') await expectSameKey(created.dataKey, result.dataKey)
    }
  })

  it('accepts the passphrase typed with a different Unicode form (NFC)', async () => {
    const created = await createKeys('café crème brûlée', FAST)
    const result = await unlockDataKey(created.envelope, {
      kind: 'passphrase',
      passphrase: 'café crème brûlée',
    })
    expect(result.status).toBe('ok')
  })

  it('reports a wrong passphrase', async () => {
    const created = await createKeys(PASSPHRASE, FAST)
    expect(
      await unlockDataKey(created.envelope, { kind: 'passphrase', passphrase: 'Correct horse battery staple' }),
    ).toEqual({ status: 'wrong-secret' })
  })

  it('reports a well-formed but wrong recovery key', async () => {
    const created = await createKeys(PASSPHRASE, FAST)
    const otherKey = formatRecoveryKey(crypto.getRandomValues(new Uint8Array(16)))
    expect(await unlockDataKey(created.envelope, { kind: 'recoveryKey', recoveryKey: otherKey })).toEqual({
      status: 'wrong-secret',
    })
  })

  it('reports a typo in the recovery key separately', async () => {
    const created = await createKeys(PASSPHRASE, FAST)
    const first = created.recoveryKey[0]
    const typo = (first === '0' ? '1' : '0') + created.recoveryKey.slice(1)
    expect(await unlockDataKey(created.envelope, { kind: 'recoveryKey', recoveryKey: typo })).toEqual({
      status: 'invalid-recovery-key',
      reason: 'checksum',
    })
  })

  it('detects a modified wrapped key or salt', async () => {
    const created = await createKeys(PASSPHRASE, FAST)
    const secret = { kind: 'passphrase', passphrase: PASSPHRASE } as const
    const tamperedKey = { ...created.envelope, wrappedKeyPass: flipBit(created.envelope.wrappedKeyPass, 20) }
    expect(await unlockDataKey(tamperedKey, secret)).toEqual({ status: 'wrong-secret' })
    const tamperedSalt = { ...created.envelope, salt: flipBit(created.envelope.salt) }
    expect(await unlockDataKey(tamperedSalt, secret)).toEqual({ status: 'wrong-secret' })
    const tamperedRec = { ...created.envelope, wrappedKeyRec: flipBit(created.envelope.wrappedKeyRec, 5) }
    expect(await unlockDataKey(tamperedRec, { kind: 'recoveryKey', recoveryKey: created.recoveryKey })).toEqual({
      status: 'wrong-secret',
    })
  })

  it('refuses a malformed envelope without trying it', async () => {
    const { envelope } = await createKeys(PASSPHRASE, FAST)
    const secret = { kind: 'passphrase', passphrase: PASSPHRASE } as const
    const cases: [Partial<KeyEnvelope>, string][] = [
      [{ salt: new Uint8Array(8) }, 'salt length'],
      [{ wrappedKeyPass: new Uint8Array(32) }, 'passphrase-wrapped key length'],
      [{ wrappedKeyRec: new Uint8Array(48) }, 'recovery-wrapped key length'],
      [{ iterations: 99_999 }, 'iteration count'],
      [{ iterations: 50_000_000 }, 'iteration count'],
      [{ keyVersion: 0 }, 'key version'],
    ]
    for (const [change, reason] of cases) {
      expect(await unlockDataKey({ ...envelope, ...change }, secret)).toEqual({
        status: 'invalid-envelope',
        reason,
      })
    }
  })
})

describe('changePassphrase', () => {
  it('re-wraps the same data key; old passphrase stops working, recovery key keeps working', async () => {
    const created = await createKeys(PASSPHRASE, FAST)
    const newPassphrase = 'a completely new passphrase'
    const changed = await changePassphrase(
      created.envelope,
      { kind: 'passphrase', passphrase: PASSPHRASE },
      newPassphrase,
      FAST,
    )
    expect(changed.status).toBe('ok')
    if (changed.status !== 'ok') return
    const { envelope } = changed

    expect(envelope.salt).not.toEqual(created.envelope.salt)
    expect(envelope.wrappedKeyRec).toEqual(created.envelope.wrappedKeyRec)
    expect(envelope.keyVersion).toBe(created.envelope.keyVersion)

    expect(await unlockDataKey(envelope, { kind: 'passphrase', passphrase: PASSPHRASE })).toEqual({
      status: 'wrong-secret',
    })
    const withNew = await unlockDataKey(envelope, { kind: 'passphrase', passphrase: newPassphrase })
    const withRecovery = await unlockDataKey(envelope, { kind: 'recoveryKey', recoveryKey: created.recoveryKey })
    if (withNew.status !== 'ok' || withRecovery.status !== 'ok') throw new Error('unlock failed')
    await expectSameKey(created.dataKey, withNew.dataKey)
    await expectSameKey(created.dataKey, withRecovery.dataKey)
  })

  it('works with the recovery key when the passphrase is forgotten', async () => {
    const created = await createKeys(PASSPHRASE, FAST)
    const changed = await changePassphrase(
      created.envelope,
      { kind: 'recoveryKey', recoveryKey: created.recoveryKey },
      'my new memorable sentence',
      FAST,
    )
    if (changed.status !== 'ok') throw new Error(changed.status)
    const opened = await unlockDataKey(changed.envelope, {
      kind: 'passphrase',
      passphrase: 'my new memorable sentence',
    })
    if (opened.status !== 'ok') throw new Error(opened.status)
    await expectSameKey(created.dataKey, opened.dataKey)
  })

  it('changes nothing when the current secret is wrong', async () => {
    const created = await createKeys(PASSPHRASE, FAST)
    expect(
      await changePassphrase(
        created.envelope,
        { kind: 'passphrase', passphrase: 'not the passphrase' },
        'a completely new passphrase',
        FAST,
      ),
    ).toEqual({ status: 'wrong-secret' })
  })

  it('refuses a new passphrase shorter than 12 characters', async () => {
    const created = await createKeys(PASSPHRASE, FAST)
    await expect(
      changePassphrase(created.envelope, { kind: 'passphrase', passphrase: PASSPHRASE }, 'short', FAST),
    ).rejects.toThrow(RangeError)
  })
})

describe('encryptRecord / decryptRecord', () => {
  it('round-trips a record, including accents and emoji', async () => {
    const { dataKey } = await createKeys(PASSPHRASE, FAST)
    const { ciphertext, iv } = await encryptOk(dataKey, context, sampleRecord)
    expect(iv).toHaveLength(12)
    expect(await decryptRecord(dataKey, context, ciphertext, iv)).toEqual({ status: 'ok', record: sampleRecord })
  })

  it('does not contain the plaintext, and uses a fresh IV every time', async () => {
    const { dataKey } = await createKeys(PASSPHRASE, FAST)
    const a = await encryptOk(dataKey, context, sampleRecord)
    const b = await encryptOk(dataKey, context, sampleRecord)
    expect(a.iv).not.toEqual(b.iv)
    expect(a.ciphertext).not.toEqual(b.ciphertext)
    expect(new TextDecoder('latin1').decode(a.ciphertext)).not.toContain('h-1')
  })

  it('detects modified ciphertext or IV', async () => {
    const { dataKey } = await createKeys(PASSPHRASE, FAST)
    const { ciphertext, iv } = await encryptOk(dataKey, context, sampleRecord)
    expect(await decryptRecord(dataKey, context, flipBit(ciphertext, 3), iv)).toEqual({ status: 'unreadable' })
    expect(await decryptRecord(dataKey, context, ciphertext, flipBit(iv))).toEqual({ status: 'unreadable' })
    expect(await decryptRecord(dataKey, context, ciphertext.slice(0, -1), iv)).toEqual({ status: 'unreadable' })
    expect(await decryptRecord(dataKey, context, ciphertext, iv.slice(0, 11))).toEqual({ status: 'unreadable' })
  })

  it('detects a record moved to another user, collection, id, revision or key version', async () => {
    const { dataKey } = await createKeys(PASSPHRASE, FAST)
    const { ciphertext, iv } = await encryptOk(dataKey, context, sampleRecord)
    const swaps: Partial<RecordContext>[] = [
      { userId: '6f1c1d2e-0000-4000-8000-000000000002' },
      { collection: 'habits' },
      { recordId: '0b8c7a52-1d1e-4f0e-9a51-6f7b1c2d3e40' },
      { revision: 2 },
      { revision: 4 },
      { keyVersion: 2 },
    ]
    for (const swap of swaps) {
      expect(await decryptRecord(dataKey, { ...context, ...swap }, ciphertext, iv), JSON.stringify(swap)).toEqual({
        status: 'unreadable',
      })
    }
  })

  it('cannot be read with another user’s key', async () => {
    const mine = await createKeys(PASSPHRASE, FAST)
    const theirs = await createKeys(PASSPHRASE, FAST)
    const { ciphertext, iv } = await encryptOk(mine.dataKey, context, sampleRecord)
    expect(await decryptRecord(theirs.dataKey, context, ciphertext, iv)).toEqual({ status: 'unreadable' })
  })

  it('refuses records whose ciphertext would exceed 1 MiB, accepts exactly 1 MiB', async () => {
    const { dataKey } = await createKeys(PASSPHRASE, FAST)
    // JSON string "xxx…" = 2 quote bytes + n; ciphertext = plaintext + 16-byte tag.
    const fits = 'x'.repeat(MAX_CIPHERTEXT_BYTES - 16 - 2)
    const result = await encryptOk(dataKey, context, fits)
    expect(result.ciphertext).toHaveLength(MAX_CIPHERTEXT_BYTES)

    expect(await encryptRecord(dataKey, context, fits + 'x')).toEqual({
      status: 'too-large',
      bytes: MAX_CIPHERTEXT_BYTES + 1,
      maximum: MAX_CIPHERTEXT_BYTES,
    })
  })

  it('reports content that decrypts but is not JSON', async () => {
    const { dataKey } = await createKeys(PASSPHRASE, FAST)
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const ciphertext = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv, additionalData: recordAad(context) },
        dataKey,
        new TextEncoder().encode('{not json'),
      ),
    )
    expect(await decryptRecord(dataKey, context, ciphertext, iv)).toEqual({ status: 'invalid-json' })
  })
})
