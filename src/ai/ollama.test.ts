import { afterEach, describe, expect, it, vi } from 'vitest'

import { listModels, OllamaUnavailableError, writeWithOllama } from './ollama'

function streamOf(parts: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({ start(controller) { parts.forEach((part) => controller.enqueue(encoder.encode(part))); controller.close() } })
}

afterEach(() => vi.unstubAllGlobals())

describe('ollama client', () => {
  it('lists installed models, and reports when Ollama is not running', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ models: [{ name: 'llama3.2:3b' }, { name: 'gemma3:1b' }] }))))
    expect(await listModels()).toEqual(['llama3.2:3b', 'gemma3:1b'])
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('connection refused') }))
    await expect(listModels()).rejects.toBeInstanceOf(OllamaUnavailableError)
  })

  it('streams the reply (lines may arrive split) and sends the request to 127.0.0.1 only', async () => {
    const fetchMock = vi.fn(async () => new Response(streamOf([
      '{"message":{"content":"You "}}\n{"message":{"con',
      'tent":"slept."}}\n',
      '{"done":true}\n',
    ])))
    vi.stubGlobal('fetch', fetchMock)
    const seen: string[] = []
    const text = await writeWithOllama({ model: 'llama3.2:3b', instructions: 'Rules', prompt: 'Facts', onText: (t) => seen.push(t) })
    expect(text).toBe('You slept.')
    expect(seen).toEqual(['You ', 'You slept.', 'You slept.'])
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://127.0.0.1:11434/api/chat')
    expect(JSON.parse(init.body as string)).toMatchObject({ model: 'llama3.2:3b', stream: true, messages: [{ role: 'system', content: 'Rules' }, { role: 'user', content: 'Facts' }] })
  })

  it('reports errors from Ollama', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(streamOf(['{"error":"model not found"}\n']))))
    await expect(writeWithOllama({ model: 'x', instructions: '', prompt: '' })).rejects.toThrow('Ollama: model not found')
  })
})
