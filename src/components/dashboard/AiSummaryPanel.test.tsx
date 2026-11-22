import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Measure } from '../../analysis/measures'
import { addDays } from '../../stats/subjects'

import { AiSummaryPanel } from './AiSummaryPanel'

const ollama = vi.hoisted(() => ({
  models: ['gemma3:1b', 'llama3.2:3b'] as string[] | null,
  reply: '',
  lastModel: '',
  lastPrompt: '',
  hang: false,
}))

vi.mock('../../ai/ollama', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../ai/ollama')>()
  return {
    ...original,
    listModels: async () => {
      if (ollama.models === null) throw new original.OllamaUnavailableError('Ollama is not running on this computer.')
      return ollama.models
    },
    writeWithOllama: async (options: { model: string; prompt: string; signal?: AbortSignal; onText?: (t: string) => void }) => {
      ollama.lastModel = options.model
      ollama.lastPrompt = options.prompt
      if (ollama.hang) {
        return new Promise((_, reject) => options.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))
      }
      options.onText?.(ollama.reply)
      return ollama.reply
    },
  }
})

const sleep: Measure = {
  id: 'sleep:duration', label: 'Sleep duration', group: 'Sleep', kind: 'duration', unit: null, per: 'night',
  daily: Array.from({ length: 10 }, (_, i) => ({ date: addDays('2026-11-01', i), value: 7.5 })),
}
const RANGE = { start: '2026-11-01', end: '2026-11-10' }

beforeEach(() => {
  ollama.models = ['gemma3:1b', 'llama3.2:3b']
  ollama.reply = ''
  ollama.hang = false
})
afterEach(() => cleanup())

describe('AiSummaryPanel', () => {
  it('says it is available only where Ollama runs', async () => {
    ollama.models = null
    render(<AiSummaryPanel measures={[sleep]} range={RANGE} />)
    expect(await screen.findByText(/available only on a computer where Ollama is running/)).toBeInTheDocument()
  })

  it('shows what the AI receives, prefers llama3.2:3b, writes and shows the app’s own caution', async () => {
    ollama.reply = 'Here is a summary:\n\nFrom 01/11/2026 to 10/11/2026 you slept on average 7 h 30 min per night over 10 nights.'
    render(<AiSummaryPanel measures={[sleep]} range={RANGE} />)

    expect(await screen.findByRole('combobox')).toHaveValue('llama3.2:3b')
    expect(screen.getByText('Sleep duration: on average 7 h 30 min per night (10 nights); no comparison with the previous period (too few days).')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Write summary (on this computer)' }))
    expect(await screen.findByText(/^From 01\/11\/2026 to 10\/11\/2026 you slept/)).toBeInTheDocument() // introduction removed
    expect(screen.getByText(/Written by a small AI on this computer/)).toBeInTheDocument()
    expect(screen.queryByText(/Check this text/)).not.toBeInTheDocument()
    expect(ollama.lastModel).toBe('llama3.2:3b')
    expect(ollama.lastPrompt).toContain('- Sleep duration: on average 7 h 30 min per night')
  })

  it('warns when the text contains numbers that were not given', async () => {
    ollama.reply = 'You slept 8 h 15 min per night.'
    render(<AiSummaryPanel measures={[sleep]} range={RANGE} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Write summary (on this computer)' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Check this text: it contains numbers that were not in the statistics it was given (8, 15).')
  })

  it('can be cancelled while writing', async () => {
    ollama.hang = true
    render(<AiSummaryPanel measures={[sleep]} range={RANGE} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Write summary (on this computer)' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(await screen.findByRole('button', { name: 'Write summary (on this computer)' })).toBeEnabled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
