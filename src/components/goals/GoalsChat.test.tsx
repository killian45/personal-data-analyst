import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ChatMessage } from '../../ai/ollama'
import type { Measure } from '../../analysis/measures'
import { loadChat } from '../../goals/chatStore'
import { EMPTY_PROFILE } from '../../goals/goals'
import { addDays } from '../../stats/subjects'

import { GoalsChat } from './GoalsChat'

const ollama = vi.hoisted(() => ({
  models: ['llama3.2:3b'] as string[] | null,
  reply: '',
  sent: [] as { messages: readonly ChatMessage[]; numCtx?: number }[],
  hang: false,
  fail: '',
}))

vi.mock('../../ai/ollama', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../ai/ollama')>()
  return {
    ...original,
    listModels: async () => {
      if (ollama.models === null) throw new original.OllamaUnavailableError('Ollama is not running on this computer.')
      return ollama.models
    },
    chatWithOllama: async (options: { messages: readonly ChatMessage[]; numCtx?: number; signal?: AbortSignal; onText?: (t: string) => void }) => {
      ollama.sent.push({ messages: options.messages, numCtx: options.numCtx })
      if (ollama.fail) throw new Error(ollama.fail)
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

function show() {
  return render(<GoalsChat measures={[sleep]} goals={[]} profile={{ ...EMPTY_PROFILE, virtues: 'Patient.' }} today="2026-11-10" />)
}

describe('GoalsChat', () => {
  beforeEach(() => {
    Object.assign(ollama, { models: ['llama3.2:3b'], reply: '', sent: [], hang: false, fail: '' })
  })
  afterEach(() => {
    cleanup()
    localStorage.clear()
  })

  it('sends the context and the question, shows and keeps the answer, flags numbers not given', async () => {
    ollama.reply = 'You sleep 7 h 30 min. Try 20 minutes of reading.'
    const user = userEvent.setup()
    show()
    await user.click(await screen.findByText('What the AI receives'))
    expect(screen.getByText('Strengths: Patient.')).toBeInTheDocument()

    await user.type(screen.getByLabelText('Your message'), 'How is my sleep?{Enter}')
    const conversation = await screen.findByRole('list', { name: 'Conversation' })
    expect(await within(conversation).findByText('You sleep 7 h 30 min. Try 20 minutes of reading.')).toBeInTheDocument()
    // 7 and 30 are in the statistics; 20 is not.
    expect(within(conversation).getByText(/Not found in your data or your messages: 20\./)).toBeInTheDocument()

    const [call] = ollama.sent
    expect(call.numCtx).toBe(4096)
    expect(call.messages[0].role).toBe('system')
    expect(call.messages[0].content).toContain('Sleep duration: on average 7 h 30 min per night')
    expect(call.messages.slice(1)).toEqual([{ role: 'user', content: 'How is my sleep?' }])
    expect(loadChat().map((m) => [m.role, m.content])).toEqual([['user', 'How is my sleep?'], ['assistant', ollama.reply]])

    // The next question carries the earlier messages.
    ollama.reply = 'Keep going.'
    await user.type(screen.getByLabelText('Your message'), 'Thanks{Enter}')
    expect(await within(conversation).findByText('Keep going.')).toBeInTheDocument()
    expect(ollama.sent[1].messages.slice(1).map((m) => m.content)).toEqual(['How is my sleep?', 'You sleep 7 h 30 min. Try 20 minutes of reading.', 'Thanks'])
  })

  it('cancelling or a failure puts the question back and saves nothing', async () => {
    ollama.hang = true
    const user = userEvent.setup()
    show()
    await user.type(await screen.findByLabelText('Your message'), 'Hello{Enter}')
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(await screen.findByLabelText('Your message')).toHaveValue('Hello')
    expect(screen.queryByRole('list', { name: 'Conversation' })).not.toBeInTheDocument()
    expect(loadChat()).toEqual([])

    ollama.hang = false
    ollama.fail = 'Ollama: model not found'
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Ollama: model not found')
    expect(screen.getByLabelText('Your message')).toHaveValue('Hello')
    expect(loadChat()).toEqual([])
  })

  it('restores the kept conversation and clears it in two steps', async () => {
    localStorage.setItem('pda.goalsChat', JSON.stringify({ version: 1, messages: [{ role: 'user', content: 'Earlier question', at: '2026-11-09T20:00:00.000Z' }] }))
    const user = userEvent.setup()
    show()
    expect(await screen.findByText('Earlier question')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Clear the conversation' }))
    await user.click(screen.getByRole('button', { name: 'Keep it' }))
    expect(screen.getByText('Earlier question')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Clear the conversation' }))
    await user.click(screen.getByRole('button', { name: 'Confirm: clear the conversation' }))
    expect(screen.queryByText('Earlier question')).not.toBeInTheDocument()
    expect(localStorage.getItem('pda.goalsChat')).toBeNull()
  })

  it('explains when Ollama is not running', async () => {
    ollama.models = null
    show()
    expect(await screen.findByText(/available only on a computer where Ollama is running/)).toBeInTheDocument()
  })
})
