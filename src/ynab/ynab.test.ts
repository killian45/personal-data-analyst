import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { validateExternalSampleRecord } from '../backup/restore/validateRecords'
import { createBackup } from '../backup/backup'
import { db } from '../database/db'

import { getTransactions, listBudgets, YnabError } from './ynabApi'
import { getYnabConnection, resetYnabConnectionCacheForTests, setYnabConnection, YNAB_CONNECTION_KEY } from './ynabConnection'
import { OTHER_CATEGORY, spendingByCategory, spendingForCategories, spendingSummary, sumSeries } from './ynabDaily'
import { applyYnabImport, planYnabImport, previewYnabImport, transactionSample } from './ynabImport'
import type { YnabTransaction } from './ynabApi'

const TOKEN = 'test-token-not-real'

function answer(status: number, data: unknown): Response {
  return new Response(JSON.stringify({ data }), { status, headers: { 'Content-Type': 'application/json' } })
}

const tx = (id: string, date: string, amount: number, changes: Record<string, unknown> = {}) => ({
  id, date, amount, memo: null, cleared: 'cleared', approved: true, flag_color: null, account_name: 'Current account',
  payee_name: 'Bakery', category_name: 'Groceries', transfer_account_id: null, deleted: false, subtransactions: [], ...changes,
})

beforeEach(async () => {
  await db.delete()
  await db.open()
  localStorage.clear()
  resetYnabConnectionCacheForTests()
})

afterEach(async () => {
  vi.restoreAllMocks()
  db.close()
  await db.delete()
})

describe('YNAB API answers are checked', () => {
  it('lists budgets with their currency, sending the token in the header', async () => {
    const fetchFn = vi.fn(async () => answer(200, { budgets: [{ id: 'b1', name: 'My budget', currency_format: { iso_code: 'EUR' } }, { id: '', name: 'broken' }] }))
    expect(await listBudgets(TOKEN, fetchFn)).toEqual([{ id: 'b1', name: 'My budget', currency: 'EUR' }])
    expect(fetchFn).toHaveBeenCalledWith('https://api.ynab.com/v1/budgets', { headers: { Authorization: `Bearer ${TOKEN}` } })
  })

  it('explains a refused token, the hourly limit and network failures', async () => {
    await expect(listBudgets(TOKEN, async () => new Response('', { status: 401 }))).rejects.toMatchObject({ kind: 'auth' })
    await expect(listBudgets(TOKEN, async () => new Response('', { status: 429 }))).rejects.toMatchObject({ kind: 'rate-limit' })
    await expect(listBudgets(TOKEN, async () => { throw new TypeError('offline') })).rejects.toBeInstanceOf(YnabError)
  })

  it('first time: since a date; then: only changes since the last position; unreadable ones listed', async () => {
    const fetchFn = vi.fn(async () => answer(200, { transactions: [tx('t1', '2026-11-10', -12500), { id: 't2', date: 'bad', amount: 1 }], server_knowledge: 42 }))
    const first = await getTransactions(TOKEN, 'b1', { lastKnowledge: null, sinceDate: '2025-11-12' }, fetchFn)
    expect(first).toMatchObject({ serverKnowledge: 42, unreadable: ['t2'] })
    expect(first.transactions.map((t) => [t.id, t.amount])).toEqual([['t1', -12500]])
    expect(fetchFn).toHaveBeenLastCalledWith('https://api.ynab.com/v1/budgets/b1/transactions?since_date=2025-11-12', expect.anything())
    await getTransactions(TOKEN, 'b1', { lastKnowledge: 42, sinceDate: '2025-11-12' }, fetchFn)
    expect(fetchFn).toHaveBeenLastCalledWith('https://api.ynab.com/v1/budgets/b1/transactions?last_knowledge_of_server=42', expect.anything())
  })
})

describe('planning', () => {
  const options = { budgetId: 'b1', currency: 'EUR', zone: 'Europe/Paris', importedAt: '2026-11-12T08:00:00.000Z', newId: () => crypto.randomUUID() }
  const read = (raw: ReturnType<typeof tx>): YnabTransaction => ({
    id: raw.id, date: raw.date, amount: raw.amount, memo: raw.memo, cleared: raw.cleared, approved: raw.approved, flagColor: raw.flag_color,
    accountName: raw.account_name, payeeName: raw.payee_name, categoryName: raw.category_name, transferAccountId: raw.transfer_account_id,
    deleted: raw.deleted, subtransactions: [],
  })

  it('stores exact amounts (milliunits kept) at the local start of the day', () => {
    const sample = transactionSample(read(tx('t1', '2026-11-10', -12345)), options)
    expect(sample).toMatchObject({
      source: 'ynab', externalId: 't1', dedupeKey: 'ynab:b1:t1', measurementType: 'ynab_transaction', value: -12.345, unit: 'EUR',
      startUtc: '2026-11-09T23:00:00.000Z', timezone: 'Europe/Paris', startOffsetMinutes: 60,
      metadata: { localDate: '2026-11-10', amountMilliunits: -12345, payeeName: 'Bakery', transfer: false },
    })
    expect(validateExternalSampleRecord(sample as unknown as Record<string, unknown>)).toEqual(sample)
  })

  it('adds, updates (YNAB edits), deletes (YNAB deletions) and leaves PDA deletions alone', () => {
    const kept = transactionSample(read(tx('keep', '2026-11-01', -1000)), options)
    const edited = transactionSample(read(tx('edit', '2026-11-02', -2000)), options)
    const removed = transactionSample(read(tx('gone', '2026-11-03', -3000)), options)
    const userDeleted = { ...transactionSample(read(tx('mine', '2026-11-04', -4000)), options), deletedAt: '2026-11-05T00:00:00.000Z' }
    const plan = planYnabImport([
      read(tx('keep', '2026-11-01', -1000)),
      read(tx('edit', '2026-11-02', -2500)),
      read(tx('gone', '2026-11-03', -3000, { deleted: true })),
      read(tx('mine', '2026-11-04', -4500)),
      read(tx('new', '2026-11-06', -600)),
      read(tx('never-seen-deleted', '2026-11-06', -1, { deleted: true })),
    ], [kept, edited, removed, userDeleted], options, 77)
    expect(plan.unchanged).toBe(1)
    expect(plan.toAdd.map((s) => s.externalId)).toEqual(['new'])
    expect(plan.toUpdate.map((s) => [s.externalId, s.value, s.revision, s.id])).toEqual([['edit', -2.5, 2, edited.id]])
    expect(plan.toDelete.map((s) => [s.externalId, s.deletedAt, s.revision])).toEqual([['gone', options.importedAt, 2]])
    expect(plan.deletedInPda).toBe(1)
    expect(plan.serverKnowledge).toBe(77)
  })
})

describe('preview and apply', () => {
  it('imports, remembers YNAB\'s position only after saving, and fetches only changes next time', async () => {
    setYnabConnection({ token: TOKEN, budgetId: 'b1', budgetName: 'My budget', currency: 'EUR', serverKnowledge: null })
    const fetchFn = vi.fn(async () => answer(200, { transactions: [tx('t1', '2026-11-10', -12500)], server_knowledge: 10 }))
    const preview = await previewYnabImport(new Date('2026-11-12T08:00:00Z'), fetchFn)
    expect(getYnabConnection()?.serverKnowledge).toBeNull()
    expect(await applyYnabImport(preview)).toBe(1)
    expect(getYnabConnection()?.serverKnowledge).toBe(10)
    expect(await db.externalSamples.count()).toBe(1)

    fetchFn.mockImplementation(async () => answer(200, { transactions: [tx('t1', '2026-11-10', -12500, { deleted: true })], server_knowledge: 11 }))
    const second = await previewYnabImport(new Date('2026-11-12T09:00:00Z'), fetchFn)
    expect(fetchFn).toHaveBeenLastCalledWith('https://api.ynab.com/v1/budgets/b1/transactions?last_knowledge_of_server=10', expect.anything())
    await applyYnabImport(second)
    expect((await db.externalSamples.toArray())[0].deletedAt).not.toBeNull()
  })

  it('the token is kept on this device only: never in backups', async () => {
    setYnabConnection({ token: TOKEN, budgetId: 'b1', budgetName: 'My budget', currency: 'EUR', serverKnowledge: 3 })
    expect(localStorage.getItem(YNAB_CONNECTION_KEY)).toContain(TOKEN)
    expect(JSON.stringify(await createBackup())).not.toContain(TOKEN)
    setYnabConnection(null)
    expect(localStorage.getItem(YNAB_CONNECTION_KEY)).toBeNull()
  })
})

describe('spendingSummary', () => {
  const options = { budgetId: 'b1', currency: 'EUR', zone: 'Europe/Paris', importedAt: '2026-11-12T08:00:00.000Z', newId: () => crypto.randomUUID() }
  const sample = (id: string, date: string, amount: number, extra: Partial<YnabTransaction> = {}) => transactionSample({
    id, date, amount, memo: null, cleared: null, approved: true, flagColor: null, accountName: 'A', payeeName: null,
    categoryName: 'Groceries', transferAccountId: null, deleted: false, subtransactions: [], ...extra,
  }, options)

  it('money out per day; income and transfers excluded; split parts counted; 0 on days without spending', () => {
    const summary = spendingSummary([
      sample('a', '2026-11-08', -12500),
      sample('salary', '2026-11-08', 2000000),
      sample('transfer', '2026-11-09', -50000, { transferAccountId: 'savings' }),
      sample('split', '2026-11-10', -30000, {
        categoryName: null,
        subtransactions: [
          { id: 's1', amount: -20000, memo: null, payeeName: null, categoryName: 'Eating out', transferAccountId: null, deleted: false },
          { id: 's2', amount: -10000, memo: null, payeeName: null, categoryName: null, transferAccountId: 'savings', deleted: false },
        ],
      }),
    ], '2026-11-11')
    expect(summary.daily).toEqual([
      { date: '2026-11-08', value: 12.5 },
      { date: '2026-11-09', value: 0 },
      { date: '2026-11-10', value: 20 },
      { date: '2026-11-11', value: 0 },
    ])
    expect(summary.byCategory).toEqual([{ name: 'Eating out', amount: 20 }, { name: 'Groceries', amount: 12.5 }])
    expect(summary.currency).toBe('EUR')
  })
})

describe('spendingByCategory (stacked chart)', () => {
  const options = { budgetId: 'b1', currency: 'EUR', zone: 'Europe/Paris', importedAt: '2026-11-12T08:00:00.000Z', newId: () => crypto.randomUUID() }
  const sample = (id: string, date: string, amount: number, categoryName: string) => transactionSample({
    id, date, amount, memo: null, cleared: null, approved: true, flagColor: null, accountName: 'A', payeeName: null,
    categoryName, transferAccountId: null, deleted: false, subtransactions: [],
  }, options)

  it('one series per category, ordered by total over all data; 0 on days without spending in it', () => {
    const result = spendingByCategory([
      sample('a', '2026-11-08', -5000, 'Rent'),
      sample('b', '2026-11-08', -1000, 'Food'),
      sample('c', '2026-11-09', -2000, 'Food'),
    ], '2026-11-09')
    expect(result.categories).toEqual(['Rent', 'Food'])
    expect(result.series).toEqual([
      { key: 'Rent', daily: [{ date: '2026-11-08', value: 5 }, { date: '2026-11-09', value: 0 }] },
      { key: 'Food', daily: [{ date: '2026-11-08', value: 1 }, { date: '2026-11-09', value: 2 }] },
    ])
  })

  it('more categories than colours: the smallest are grouped as Other (8 slots in all)', () => {
    const many = Array.from({ length: 10 }, (_, index) => sample(`t${index}`, '2026-11-08', -(index + 1) * 1000, `C${index}`))
    const result = spendingByCategory(many, '2026-11-08')
    expect(result.categories).toEqual(['C9', 'C8', 'C7', 'C6', 'C5', 'C4', 'C3', OTHER_CATEGORY])
    // Other = C2 + C1 + C0 = 3 + 2 + 1
    expect(result.series[7].daily).toEqual([{ date: '2026-11-08', value: 6 }])
  })
})

describe('chosen categories', () => {
  const options = { budgetId: 'b1', currency: 'EUR', zone: 'Europe/Paris', importedAt: '2026-11-12T08:00:00.000Z', newId: () => crypto.randomUUID() }
  const sample = (id: string, date: string, amount: number, categoryName: string) => transactionSample({
    id, date, amount, memo: null, cleared: null, approved: true, flagColor: null, accountName: 'A', payeeName: null,
    categoryName, transferAccountId: null, deleted: false, subtransactions: [],
  }, options)

  it('one series per chosen category (zeros for one without spending), and their day-by-day sum', () => {
    const samples = [sample('a', '2026-11-08', -5000, 'Rent'), sample('b', '2026-11-09', -2000, 'Food')]
    const series = spendingForCategories(samples, '2026-11-09', ['Food', 'Holidays'])
    expect(series).toEqual([
      { key: 'Food', daily: [{ date: '2026-11-08', value: 0 }, { date: '2026-11-09', value: 2 }] },
      { key: 'Holidays', daily: [{ date: '2026-11-08', value: 0 }, { date: '2026-11-09', value: 0 }] },
    ])
    expect(sumSeries(spendingForCategories(samples, '2026-11-09', ['Food', 'Rent']))).toEqual([
      { date: '2026-11-08', value: 5 }, { date: '2026-11-09', value: 2 },
    ])
  })
})

