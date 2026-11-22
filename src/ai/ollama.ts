import { messages } from '../i18n'
/**
 * Minimal client for Ollama running on this computer (Phase 6 step 5).
 * Talks only to 127.0.0.1 (Ollama listens there and refuses other web
 * sites); nothing leaves the computer. Plain fetch, no new dependency.
 */

export const OLLAMA_URL = 'http://127.0.0.1:11434'
export const PREFERRED_MODEL = 'llama3.2:3b'

export class OllamaUnavailableError extends Error {}

/** Installed models, or OllamaUnavailableError when Ollama is not running here. */
export async function listModels(): Promise<string[]> {
  let response: Response
  try {
    response = await fetch(`${OLLAMA_URL}/api/tags`)
  } catch {
    throw new OllamaUnavailableError(messages().importText.ollama.notRunning)
  }
  if (!response.ok) throw new OllamaUnavailableError(messages().importText.ollama.badAnswer)
  const body = (await response.json()) as { models?: { name?: unknown }[] }
  return (body.models ?? []).map((model) => model.name).filter((name): name is string => typeof name === 'string')
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/**
 * Sends a conversation to the local model and streams the reply, calling
 * onText with the text so far; resolves with the full text.
 */
export async function chatWithOllama(options: {
  model: string
  messages: readonly ChatMessage[]
  /** Context size in tokens (larger = more memory). */
  numCtx?: number
  temperature?: number
  /** How long Ollama keeps the model (and the context it has read) in memory afterwards. */
  keepAlive?: string
  signal?: AbortSignal
  onText?: (text: string) => void
}): Promise<string> {
  let response: Response
  try {
    response = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: options.signal,
      body: JSON.stringify({
        model: options.model,
        stream: true,
        keep_alive: options.keepAlive ?? '2m',
        options: { temperature: options.temperature ?? 0.2, num_ctx: options.numCtx ?? 2048 },
        messages: options.messages,
      }),
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new OllamaUnavailableError(messages().importText.ollama.notRunning)
  }
  if (!response.ok || !response.body) throw new Error(messages().importText.ollama.couldNotAnswer(response.status))

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let text = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let newline = buffer.indexOf('\n')
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      if (line) {
        const chunk = JSON.parse(line) as { message?: { content?: string }; error?: string }
        if (chunk.error) throw new Error(`Ollama: ${chunk.error}`)
        text += chunk.message?.content ?? ''
        options.onText?.(text)
      }
      newline = buffer.indexOf('\n')
    }
  }
  return text
}

/** Writes one reply to one prompt (the Dashboard's AI summary). */
export async function writeWithOllama(options: {
  model: string
  instructions: string
  prompt: string
  signal?: AbortSignal
  onText?: (text: string) => void
}): Promise<string> {
  return chatWithOllama({
    model: options.model,
    numCtx: 2048,
    temperature: 0.2,
    signal: options.signal,
    onText: options.onText,
    messages: [
      { role: 'system', content: options.instructions },
      { role: 'user', content: options.prompt },
    ],
  })
}
