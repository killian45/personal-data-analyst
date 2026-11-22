import { bytesStream, crc32 } from './zip'

async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const reader = bytesStream(data)
    .pipeThrough(new CompressionStream('deflate-raw') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>)
    .getReader()
  const chunks: Uint8Array[] = []

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
  }

  const result = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0))
  let position = 0
  for (const chunk of chunks) {
    result.set(chunk, position)
    position += chunk.length
  }
  return result
}

/**
 * Builds a small zip archive for tests. With `dataDescriptor`, local
 * headers carry no sizes or CRC (flag bit 3), like Health Connect exports.
 */
export async function buildZip(
  files: { name: string; content: Uint8Array; deflate?: boolean }[],
  options: { dataDescriptor?: boolean; encrypted?: boolean } = {},
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0

  for (const file of files) {
    const name = new TextEncoder().encode(file.name)
    const data = file.deflate ? await deflateRaw(file.content) : file.content
    const crc = crc32(file.content)
    const flags = (options.dataDescriptor ? 8 : 0) | (options.encrypted ? 1 : 0) | 0x800
    const method = file.deflate ? 8 : 0

    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, 0x04034b50, true)
    local.setUint16(4, 20, true)
    local.setUint16(6, flags, true)
    local.setUint16(8, method, true)
    local.setUint32(14, options.dataDescriptor ? 0 : crc, true)
    local.setUint32(18, options.dataDescriptor ? 0 : data.length, true)
    local.setUint32(22, options.dataDescriptor ? 0 : file.content.length, true)
    local.setUint16(26, name.length, true)

    const header = new DataView(new ArrayBuffer(46))
    header.setUint32(0, 0x02014b50, true)
    header.setUint16(4, 20, true)
    header.setUint16(6, 20, true)
    header.setUint16(8, flags, true)
    header.setUint16(10, method, true)
    header.setUint32(16, crc, true)
    header.setUint32(20, data.length, true)
    header.setUint32(24, file.content.length, true)
    header.setUint16(28, name.length, true)
    header.setUint32(42, offset, true)

    const parts = [new Uint8Array(local.buffer), name, data]

    if (options.dataDescriptor) {
      const descriptor = new DataView(new ArrayBuffer(16))
      descriptor.setUint32(0, 0x08074b50, true)
      descriptor.setUint32(4, crc, true)
      descriptor.setUint32(8, data.length, true)
      descriptor.setUint32(12, file.content.length, true)
      parts.push(new Uint8Array(descriptor.buffer))
    }

    for (const part of parts) {
      chunks.push(part)
      offset += part.length
    }

    central.push(new Uint8Array(header.buffer), name)
  }

  const centralSize = central.reduce((sum, part) => sum + part.length, 0)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true)
  end.setUint16(8, files.length, true)
  end.setUint16(10, files.length, true)
  end.setUint32(12, centralSize, true)
  end.setUint32(16, offset, true)

  const all = [...chunks, ...central, new Uint8Array(end.buffer)]
  const result = new Uint8Array(all.reduce((sum, part) => sum + part.length, 0))
  let position = 0

  for (const part of all) {
    result.set(part, position)
    position += part.length
  }

  return result
}
