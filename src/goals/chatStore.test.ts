import { afterEach, describe, expect, it } from 'vitest'

import { clearChat, GOALS_CHAT_KEY, loadChat, MAX_STORED_MESSAGES, parseChat, saveChat } from './chatStore'

const AT = '2026-11-13T10:00:00.000Z'

afterEach(() => localStorage.clear())

describe('chat storage (this computer only)', () => {
  it('saves, loads and clears the conversation', () => {
    saveChat([{ role: 'user', content: 'Hello', at: AT }, { role: 'assistant', content: 'Hi', at: AT }])
    expect(loadChat()).toEqual([{ role: 'user', content: 'Hello', at: AT }, { role: 'assistant', content: 'Hi', at: AT }])
    clearChat()
    expect(localStorage.getItem(GOALS_CHAT_KEY)).toBeNull()
    expect(loadChat()).toEqual([])
  })

  it('keeps only the newest messages', () => {
    const many = Array.from({ length: MAX_STORED_MESSAGES + 5 }, (_, i) => ({ role: 'user' as const, content: `m${i}`, at: AT }))
    expect(saveChat(many)[0].content).toBe('m5')
    expect(loadChat()).toHaveLength(MAX_STORED_MESSAGES)
  })

  it('ignores unreadable or invalid content instead of failing', () => {
    expect(parseChat(null)).toEqual([])
    expect(parseChat('not json')).toEqual([])
    expect(parseChat(JSON.stringify({ version: 2, messages: [] }))).toEqual([])
    expect(parseChat(JSON.stringify({ version: 1, messages: [{ role: 'system', content: 'x', at: AT }, { role: 'user', content: 'ok', at: 'yesterday' }, { role: 'user', content: 'kept', at: AT }] })))
      .toEqual([{ role: 'user', content: 'kept', at: AT }])
  })
})
