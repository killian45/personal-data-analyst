/**
 * The YNAB connection of THIS device (docs/YNAB_PLAN.md): access token,
 * chosen budget and YNAB's "server knowledge" (position for the next
 * delta request). Stored in localStorage only — never synchronised and
 * never in backups (the token gives access to the user's YNAB account).
 * The imported transactions themselves are synchronised like other data.
 */

export const YNAB_CONNECTION_KEY = 'pda.ynabConnection'

export interface YnabConnection {
  token: string
  budgetId: string
  budgetName: string
  currency: string | null
  serverKnowledge: number | null
}

const listeners = new Set<() => void>()
let cached: YnabConnection | null | undefined

export function parseConnection(raw: string | null): YnabConnection | null {
  if (raw === null) return null
  try {
    const value = JSON.parse(raw) as Record<string, unknown>
    if (typeof value.token !== 'string' || value.token === '' || typeof value.budgetId !== 'string' || typeof value.budgetName !== 'string') return null
    return {
      token: value.token,
      budgetId: value.budgetId,
      budgetName: value.budgetName,
      currency: typeof value.currency === 'string' ? value.currency : null,
      serverKnowledge: typeof value.serverKnowledge === 'number' && Number.isInteger(value.serverKnowledge) ? value.serverKnowledge : null,
    }
  } catch {
    return null
  }
}

export function getYnabConnection(): YnabConnection | null {
  if (cached === undefined) {
    try {
      cached = parseConnection(localStorage.getItem(YNAB_CONNECTION_KEY))
    } catch {
      cached = null
    }
  }
  return cached
}

export function setYnabConnection(next: YnabConnection | null): void {
  cached = next
  try {
    if (next === null) localStorage.removeItem(YNAB_CONNECTION_KEY)
    else localStorage.setItem(YNAB_CONNECTION_KEY, JSON.stringify(next))
  } catch (error) {
    console.error('Could not save the YNAB connection:', error)
  }
  for (const listener of listeners) listener()
}

export function subscribeYnabConnection(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Tests only. */
export function resetYnabConnectionCacheForTests(): void {
  cached = undefined
}
