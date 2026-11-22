import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { db } from '../database/db'
import { getYnabConnection, resetYnabConnectionCacheForTests } from '../ynab/ynabConnection'

import YnabPanel from './YnabPanel'

const json = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200, headers: { 'Content-Type': 'application/json' } })

describe('YnabPanel', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
    localStorage.clear()
    resetYnabConnectionCacheForTests()
  })

  afterEach(async () => {
    cleanup()
    vi.unstubAllGlobals()
    db.close()
    await db.delete()
  })

  it('connects with a token, lets the user choose the budget, imports, and disconnects keeping the data', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/budgets')) return json({ budgets: [{ id: 'b1', name: 'Home', currency_format: { iso_code: 'EUR' } }, { id: 'b2', name: 'Work', currency_format: { iso_code: 'EUR' } }] })
      return json({
        transactions: [{ id: 't1', date: '2026-11-10', amount: -12500, memo: null, cleared: 'cleared', approved: true, flag_color: null, account_name: 'A', payee_name: 'Bakery', category_name: 'Groceries', transfer_account_id: null, deleted: false, subtransactions: [] }],
        server_knowledge: 5,
      })
    }))
    const onImported = vi.fn()
    const user = userEvent.setup()
    render(<YnabPanel controller={null} syncConfigured={false} onImported={onImported} />)

    const field = screen.getByLabelText('Personal access token')
    expect(field).toHaveAttribute('type', 'password')
    await user.type(field, 'secret-token')
    await user.click(screen.getByRole('button', { name: 'Connect' }))
    await user.click(await screen.findByRole('button', { name: 'Work (EUR)' }))
    expect(screen.getByText(/Connected on this device to the budget/)).toHaveTextContent('Work (EUR)')
    expect(getYnabConnection()).toMatchObject({ token: 'secret-token', budgetId: 'b2' })

    await user.click(screen.getByRole('button', { name: 'Import now' }))
    expect(await screen.findByRole('status')).toHaveTextContent('1 added, 0 changed, 0 deleted, 0 unchanged')
    expect(onImported).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: 'Disconnect (forget the token)' }))
    expect(getYnabConnection()).toBeNull()
    expect(screen.getByLabelText('Personal access token')).toBeInTheDocument()
    expect(await db.externalSamples.count()).toBe(1) // the transactions stay
  })

  it('explains a refused token', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 401 })))
    const user = userEvent.setup()
    render(<YnabPanel controller={null} syncConfigured={false} onImported={vi.fn()} />)
    await user.type(screen.getByLabelText('Personal access token'), 'wrong')
    await user.click(screen.getByRole('button', { name: 'Connect' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('YNAB refused the access token')
    expect(getYnabConnection()).toBeNull()
  })
})
