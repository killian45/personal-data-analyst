import { messages } from '../i18n'
/**
 * Minimal ZIP reader for imports (no dependency).
 *
 * - Reads the central directory, so archives whose local headers carry no
 *   sizes (general-purpose flag bit 3, as in Health Connect exports) work.
 * - Supports "stored" (method 0) and "deflate" (method 8) entries; deflate
 *   uses the browser's DecompressionStream("deflate-raw").
 * - Refuses encrypted entries, ZIP64 archives and entries larger than the
 *   given limit, and checks each entry's size and CRC-32, so a damaged or
 *   truncated file is reported instead of half-read.
 */

export interface ZipEntry {
  name: string
  method: number
  compressedSize: number
  size: number
  crc32: number
  localHeaderOffset: number
}

const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_SIGNATURE = 0x02014b50
const LOCAL_SIGNATURE = 0x04034b50

/** Default limit for one uncompressed entry: 512 MiB. */
export const MAX_ENTRY_SIZE = 512 * 1024 * 1024

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)

  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }

  return table
})()

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff

  for (let index = 0; index < bytes.length; index += 1) {
    crc = CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8)
  }

  return (crc ^ 0xffffffff) >>> 0
}

/** A zip error to show as it is (recognised by its type, not its wording). */
class ZipFileError extends Error {}

function damaged(): Error {
  return new ZipFileError(messages().importText.zip.damaged)
}

/** Lists the entries of a zip archive from its central directory. */
export function listZipEntries(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const searchStart = Math.max(0, bytes.length - 22 - 0xffff)
  let eocd = -1

  for (let offset = bytes.length - 22; offset >= searchStart; offset -= 1) {
    if (view.getUint32(offset, true) === EOCD_SIGNATURE) {
      eocd = offset
      break
    }
  }

  if (eocd < 0) {
    throw damaged()
  }

  const count = view.getUint16(eocd + 10, true)
  const directorySize = view.getUint32(eocd + 12, true)
  const directoryOffset = view.getUint32(eocd + 16, true)

  if (count === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
    throw new Error(messages().importText.zip.zip64)
  }

  if (directoryOffset + directorySize > eocd) {
    throw damaged()
  }

  const entries: ZipEntry[] = []
  let offset = directoryOffset

  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== CENTRAL_SIGNATURE) {
      throw damaged()
    }

    const flags = view.getUint16(offset + 8, true)
    const nameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)

    if (flags & 1) {
      throw new Error(messages().importText.zip.encrypted)
    }

    entries.push({
      name: new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength)),
      method: view.getUint16(offset + 10, true),
      crc32: view.getUint32(offset + 16, true),
      compressedSize: view.getUint32(offset + 20, true),
      size: view.getUint32(offset + 24, true),
      localHeaderOffset: view.getUint32(offset + 42, true),
    })

    offset += 46 + nameLength + extraLength + commentLength
  }

  return entries
}

/** A readable stream that yields the given bytes once. */
export function bytesStream(data: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(data)
      controller.close()
    },
  })
}

async function inflateRaw(data: Uint8Array, expectedSize: number): Promise<Uint8Array> {
  const reader = bytesStream(data)
    .pipeThrough(new DecompressionStream('deflate-raw') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>)
    .getReader()
  const output = new Uint8Array(expectedSize)
  let written = 0

  for (;;) {
    const { done, value } = await reader.read()

    if (done) {
      break
    }

    if (written + value.length > expectedSize) {
      await reader.cancel()
      throw damaged()
    }

    output.set(value, written)
    written += value.length
  }

  if (written !== expectedSize) {
    throw damaged()
  }

  return output
}

/** Reads and checks one entry's uncompressed content. */
export async function readZipEntry(
  bytes: Uint8Array,
  entry: ZipEntry,
  maxSize: number = MAX_ENTRY_SIZE,
): Promise<Uint8Array> {
  if (entry.size > maxSize) {
    throw new Error(messages().importText.zip.tooLarge)
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const local = entry.localHeaderOffset

  if (local + 30 > bytes.length || view.getUint32(local, true) !== LOCAL_SIGNATURE) {
    throw damaged()
  }

  const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true)
  const end = start + entry.compressedSize

  if (end > bytes.length) {
    throw damaged()
  }

  const compressed = bytes.subarray(start, end)
  let content: Uint8Array

  if (entry.method === 0) {
    if (entry.compressedSize !== entry.size) {
      throw damaged()
    }
    content = compressed.slice()
  } else if (entry.method === 8) {
    try {
      content = await inflateRaw(compressed, entry.size)
    } catch (caughtError) {
      throw caughtError instanceof ZipFileError ? caughtError : damaged()
    }
  } else {
    throw new Error(messages().importText.zip.method(entry.method))
  }

  if (crc32(content) !== entry.crc32) {
    throw damaged()
  }

  return content
}
