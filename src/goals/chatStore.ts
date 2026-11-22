/**
 * The Goals chat, kept on this computer only (docs/GOALS_PLAN.md: not
 * synchronised, not in backups, deleted by "Delete all data on this
 * device"). localStorage, like the YNAB connection.
 */

export const GOALS_CHAT_KEY = 'pda.goalsChat'
/** Older messages are dropped beyond this many. */
export const MAX_STORED_MESSAGES = 100
export const MAX_MESSAGE_LENGTH = 10_000

export interface StoredChatMessage {
  role: 'user' | 'assistant'
  content: string
  /** UTC ISO time. */
  at: string
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

/** Reads the stored chat; anything unreadable gives an empty chat (never throws). */
export function parseChat(text: string | null): StoredChatMessage[] {
  if (text === null) return []
  try {
    const value = JSON.parse(text) as { version?: unknown; messages?: unknown }
    if (value?.version !== 1 || !Array.isArray(value.messages)) return []
    return value.messages.filter(
      (message): message is StoredChatMessage =>
        typeof message === 'object' && message !== null &&
        ((message as StoredChatMessage).role === 'user' || (message as StoredChatMessage).role === 'assistant') &&
        typeof (message as StoredChatMessage).content === 'string' && (message as StoredChatMessage).content.length <= MAX_MESSAGE_LENGTH &&
        typeof (message as StoredChatMessage).at === 'string' && ISO.test((message as StoredChatMessage).at),
    ).slice(-MAX_STORED_MESSAGES)
  } catch {
    return []
  }
}

export function loadChat(): StoredChatMessage[] {
  try {
    return parseChat(localStorage.getItem(GOALS_CHAT_KEY))
  } catch {
    return []
  }
}

/** Saves the chat (the newest MAX_STORED_MESSAGES); returns what was kept. */
export function saveChat(messages: readonly StoredChatMessage[]): StoredChatMessage[] {
  const kept = messages.slice(-MAX_STORED_MESSAGES).map((message) => ({ ...message, content: message.content.slice(0, MAX_MESSAGE_LENGTH) }))
  localStorage.setItem(GOALS_CHAT_KEY, JSON.stringify({ version: 1, messages: kept }))
  return kept
}

export function clearChat(): void {
  try {
    localStorage.removeItem(GOALS_CHAT_KEY)
  } catch {
    // Storage unavailable: nothing stored.
  }
}
