import { describe, expect, it } from 'vitest'

import { buildZip } from './testZip'
import { crc32, listZipEntries, readZipEntry } from './zip'

const text = (value: string) => new TextEncoder().encode(value)
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

describe('crc32', () => {
  it('matches the standard check value', () => {
    // CRC-32 of "123456789" is 0xCBF43926 (ISO-HDLC check value).
    expect(crc32(text('123456789'))).toBe(0xcbf43926)
  })
})

describe('zip reader', () => {
  const content = text('Hello, sleep! '.repeat(200))

  it('lists entries and reads stored and deflated files', async () => {
    const zip = await buildZip([
      { name: 'stored.txt', content: text('plain') },
      { name: 'packed.db', content, deflate: true },
    ])
    const entries = listZipEntries(zip)

    expect(entries.map((entry) => [entry.name, entry.method, entry.size])).toEqual([
      ['stored.txt', 0, 5],
      ['packed.db', 8, content.length],
    ])
    expect(decode(await readZipEntry(zip, entries[0]))).toBe('plain')
    expect(decode(await readZipEntry(zip, entries[1]))).toBe(decode(content))
  })

  it('reads archives whose local headers have no sizes (data descriptor), like Health Connect exports', async () => {
    const zip = await buildZip([{ name: 'health_connect_export.db', content, deflate: true }], { dataDescriptor: true })
    const [entry] = listZipEntries(zip)

    expect(decode(await readZipEntry(zip, entry))).toBe(decode(content))
  })

  it('detects damaged content through the CRC', async () => {
    const zip = await buildZip([{ name: 'a.txt', content: text('abcdef') }])
    const damaged = zip.slice()
    damaged[30 + 'a.txt'.length] ^= 0xff

    await expect(readZipEntry(damaged, listZipEntries(damaged)[0])).rejects.toThrow('not a valid zip archive, or it is damaged')
  })

  it('rejects files that are not zip archives or are truncated', async () => {
    expect(() => listZipEntries(text('just some text that is long enough to search'))).toThrow('not a valid zip archive')

    const zip = await buildZip([{ name: 'a.txt', content, deflate: true }])
    const entries = listZipEntries(zip)
    const truncated = zip.slice(0, 60)
    await expect(readZipEntry(truncated, entries[0])).rejects.toThrow('damaged')
  })

  it('refuses encrypted archives and entries above the size limit', async () => {
    const encrypted = await buildZip([{ name: 'a.txt', content: text('x') }], { encrypted: true })
    expect(() => listZipEntries(encrypted)).toThrow('Encrypted zip archives are not supported.')

    const zip = await buildZip([{ name: 'a.txt', content }])
    await expect(readZipEntry(zip, listZipEntries(zip)[0], 10)).rejects.toThrow('too large to import')
  })
})
