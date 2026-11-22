import { messages } from '../i18n'
/**
 * YNAB API (https://api.ynab.com/v1), read only, with the user's personal
 * access token (docs/YNAB_PLAN.md). The API allows browser requests
 * (CORS "*" with the Authorization header, checked 2026-11-12), so the
 * same code runs on the computer and in the phone app.
 *
 * Answers are checked here (data boundary) before use.
 */

export const YNAB_API = 'https://api.ynab.com/v1'

export class YnabError extends Error {
  readonly kind: 'auth' | 'rate-limit' | 'network' | 'server' | 'invalid'

  constructor(kind: YnabError['kind'], message: string) {
    super(message)
    this.name = 'YnabError'
    this.kind = kind
  }
}

export interface YnabBudget {
  id: string
  name: string
  currency: string | null
}

export interface YnabSubtransaction {
  id: string
  amount: number
  memo: string | null
  payeeName: string | null
  categoryName: string | null
  transferAccountId: string | null
  deleted: boolean
}

export interface YnabTransaction {
  id: string
  date: string
  /** Milliunits (1 EUR = 1000); negative = money out. */
  amount: number
  memo: string | null
  cleared: string | null
  approved: boolean
  flagColor: string | null
  accountName: string | null
  payeeName: string | null
  categoryName: string | null
  transferAccountId: string | null
  deleted: boolean
  subtransactions: YnabSubtransaction[]
}

type Fetch = typeof fetch
type Raw = Record<string, unknown>

const DATE = /^\d{4}-\d{2}-\d{2}$/

function text(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

async function request(path: string, token: string, fetchFn: Fetch): Promise<Raw> {
  let response: Response
  try {
    response = await fetchFn(`${YNAB_API}${path}`, { headers: { Authorization: `Bearer ${token}` } })
  } catch {
    throw new YnabError('network', messages().importText.ynab.network)
  }
  if (response.status === 401) throw new YnabError('auth', messages().importText.ynab.auth)
  if (response.status === 429) throw new YnabError('rate-limit', messages().importText.ynab.rateLimit)
  if (!response.ok) throw new YnabError('server', messages().importText.ynab.server(response.status))
  const body: unknown = await response.json().catch(() => null)
  if (typeof body !== 'object' || body === null || typeof (body as Raw).data !== 'object') {
    throw new YnabError('invalid', messages().importText.ynab.invalid)
  }
  return (body as { data: Raw }).data
}

export async function listBudgets(token: string, fetchFn: Fetch = fetch): Promise<YnabBudget[]> {
  const data = await request('/budgets', token, fetchFn)
  if (!Array.isArray(data.budgets)) throw new YnabError('invalid', messages().importText.ynab.noBudgets)
  return (data.budgets as Raw[]).flatMap((budget) => {
    const id = text(budget.id)
    const name = text(budget.name)
    if (!id || !name) return []
    const currency = text((budget.currency_format as Raw | undefined)?.iso_code)
    return [{ id, name, currency }]
  })
}

function readSub(raw: Raw): YnabSubtransaction | null {
  const id = text(raw.id)
  if (!id || typeof raw.amount !== 'number' || !Number.isInteger(raw.amount)) return null
  return {
    id, amount: raw.amount, memo: text(raw.memo), payeeName: text(raw.payee_name), categoryName: text(raw.category_name),
    transferAccountId: text(raw.transfer_account_id), deleted: raw.deleted === true,
  }
}

/** Checks one transaction from YNAB; null (listed by the caller) when unusable. */
export function readTransaction(raw: Raw): YnabTransaction | null {
  const id = text(raw.id)
  const date = text(raw.date)
  if (!id || !date || !DATE.test(date) || typeof raw.amount !== 'number' || !Number.isInteger(raw.amount)) return null
  const subs = Array.isArray(raw.subtransactions) ? (raw.subtransactions as Raw[]).map(readSub) : []
  if (subs.some((sub) => sub === null)) return null
  return {
    id, date, amount: raw.amount, memo: text(raw.memo), cleared: text(raw.cleared), approved: raw.approved === true,
    flagColor: text(raw.flag_color), accountName: text(raw.account_name), payeeName: text(raw.payee_name),
    categoryName: text(raw.category_name), transferAccountId: text(raw.transfer_account_id), deleted: raw.deleted === true,
    subtransactions: subs as YnabSubtransaction[],
  }
}

export interface TransactionsAnswer {
  transactions: YnabTransaction[]
  /** Transactions YNAB sent that could not be read (ids when known). */
  unreadable: string[]
  serverKnowledge: number
}

/**
 * Transactions of one budget: changes since `lastKnowledge` (YNAB's delta
 * requests, including deletions) or, the first time, since `sinceDate`.
 */
export async function getTransactions(
  token: string,
  budgetId: string,
  options: { lastKnowledge: number | null; sinceDate: string },
  fetchFn: Fetch = fetch,
): Promise<TransactionsAnswer> {
  const query = options.lastKnowledge !== null
    ? `last_knowledge_of_server=${options.lastKnowledge}`
    : `since_date=${options.sinceDate}`
  const data = await request(`/budgets/${encodeURIComponent(budgetId)}/transactions?${query}`, token, fetchFn)
  if (!Array.isArray(data.transactions) || typeof data.server_knowledge !== 'number') {
    throw new YnabError('invalid', messages().importText.ynab.noTransactions)
  }
  const transactions: YnabTransaction[] = []
  const unreadable: string[] = []
  for (const raw of data.transactions as Raw[]) {
    const transaction = readTransaction(raw)
    if (transaction) transactions.push(transaction)
    else unreadable.push(text(raw.id) ?? '(no id)')
  }
  return { transactions, unreadable, serverKnowledge: data.server_knowledge }
}
