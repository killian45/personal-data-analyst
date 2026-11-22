import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ChatMessage } from '../../ai/ollama'
import type { Measure } from '../../analysis/measures'
import { EMPTY_PROFILE } from '../../goals/goals'
import type { Goal } from '../../goals/goals'
import { loadOpinions } from '../../goals/opinion'

import { GoalOpinion } from './GoalOpinion'

const ollama = vi.hoisted(() => ({ reply: '', sent: [] as (readonly ChatMessage[])[], hang: false }))

vi.mock('../../ai/ollama', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../ai/ollama')>()
  return {
    ...original,
    chatWithOllama: async (options: { messages: readonly ChatMessage[]; signal?: AbortSignal; onText?: (t: string) => void }) => {
      ollama.sent.push(options.messages)
      if (ollama.hang) return new Promise((_, reject) => options.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))
      options.onText?.(ollama.reply)
      return ollama.reply
    },
  }
})

const AT = '2026-11-01T11:00:00.000Z'
const water: Measure = { id: 'habit:water', label: 'Water', group: 'Habits', kind: 'number', unit: 'ml', per: 'day', daily: [{ date: '2026-11-08', value: 2500 }] }
const goal: Goal = {
  id: 'g1', title: 'Drink 2 litres a day', kind: 'process', progressMeasure: 'habit:water',
  success: { measure: 'habit:water', rule: 'mean-at-least', target: 2000, share: null }, ambition: 7, realism: 5,
  startUtc: AT, endUtc: '2026-11-30T11:00:00.000Z', timezone: 'Europe/Paris', createdAt: AT, updatedAt: AT,
}

function show() {
  return render(<GoalOpinion goal={goal} measures={[water]} profile={EMPTY_PROFILE} today="2026-11-10" model="llama3.2:3b" />)
}

describe('GoalOpinion', () => {
  beforeEach(() => Object.assign(ollama, { reply: '', sent: [], hang: false }))
  afterEach(() => {
    cleanup()
    localStorage.clear()
  })

  it('asks the AI with the goal’s facts, shows the opinion labelled as such, keeps it and flags numbers not given', async () => {
    ollama.reply = 'Likelihood: medium\nYou reached 2,500 ml once; aim for 9 days in a row.'
    const user = userEvent.setup()
    show()
    await user.click(screen.getByRole('button', { name: "Ask the AI's opinion" }))
    expect(await screen.findByText("Likelihood, in the AI's opinion: Medium")).toBeInTheDocument()
    expect(screen.getByText('You reached 2,500 ml once; aim for 9 days in a row.')).toBeInTheDocument()
    expect(screen.getByText(/not a\s+prediction/)).toBeInTheDocument()
    expect(screen.getByText(/Not found in what the AI received: 9\./)).toBeInTheDocument()
    expect(ollama.sent[0][1].content).toContain('Goal: "Drink 2 litres a day"')
    expect(loadOpinions().g1).toMatchObject({ likelihood: 'medium', model: 'llama3.2:3b' })

    // Shown again after reopening the page.
    cleanup()
    show()
    expect(screen.getByText("Likelihood, in the AI's opinion: Medium")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ask again' })).toBeInTheDocument()
  })

  it('cancelling keeps the previous state and saves nothing', async () => {
    ollama.hang = true
    const user = userEvent.setup()
    show()
    await user.click(screen.getByRole('button', { name: "Ask the AI's opinion" }))
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(await screen.findByRole('button', { name: "Ask the AI's opinion" })).toBeInTheDocument()
    expect(loadOpinions()).toEqual({})
  })
})
