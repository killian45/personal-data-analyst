import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({
  isNative: false,
  calls: [] as unknown[][],
  shareError: null as Error | null,
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => native.isNative },
}))

vi.mock('@capacitor/filesystem', () => ({
  Directory: { Cache: 'CACHE' },
  Filesystem: {
    rmdir: async (options: unknown) => {
      native.calls.push(['rmdir', options])
    },
    writeFile: async (options: { path: string }) => {
      native.calls.push(['writeFile', options])
      return { uri: `file:///cache/${options.path}` }
    },
  },
}))

vi.mock('@capacitor/share', () => ({
  Share: {
    share: async (options: unknown) => {
      native.calls.push(['share', options])
      if (native.shareError) throw native.shareError
    },
  },
}))

import { saveFile, toBase64 } from './saveFile'

beforeEach(() => {
  native.isNative = false
  native.calls = []
  native.shareError = null
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('toBase64', () => {
  it('encodes text and binary content (hand-checked values)', async () => {
    expect(await toBase64('hi', 'text/plain')).toBe('aGk=')
    expect(await toBase64(new Uint8Array([0, 255, 128]), 'application/octet-stream')).toBe('AP+A')
    expect(await toBase64('Été', 'text/plain')).toBe('w4l0w6k=') // UTF-8 bytes
  })
})

describe('saveFile', () => {
  it('in the browser: downloads through a link, no plugins', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:test')
    URL.revokeObjectURL = vi.fn()
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    await saveFile('{}', 'application/json', 'backup.json')

    expect(click).toHaveBeenCalledTimes(1)
    expect(native.calls).toEqual([])
  })

  it('in the Android app: clears old exports, writes to the private cache and opens the share sheet', async () => {
    native.isNative = true

    await saveFile('hi', 'text/plain', 'pda-recovery-key.txt')

    expect(native.calls).toEqual([
      ['rmdir', { path: 'exports', directory: 'CACHE', recursive: true }],
      ['writeFile', { path: 'exports/pda-recovery-key.txt', data: 'aGk=', directory: 'CACHE', recursive: true }],
      [
        'share',
        {
          title: 'pda-recovery-key.txt',
          dialogTitle: 'Save or send pda-recovery-key.txt',
          files: ['file:///cache/exports/pda-recovery-key.txt'],
        },
      ],
    ])
  })

  it('reports a cancelled share clearly', async () => {
    native.isNative = true
    native.shareError = new Error('Share canceled')

    await expect(saveFile('{}', 'application/json', 'backup.json')).rejects.toThrow(
      'Sharing was cancelled: the file was not saved anywhere.',
    )
  })
})
