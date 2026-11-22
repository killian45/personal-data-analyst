import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { db } from '../database/db'
import { createKeys, MIN_PBKDF2_ITERATIONS } from '../sync/crypto'
import { linkDevice } from '../sync/device'
import { SYNC_SERVER_KEY } from '../sync/serverConfig'
import { SyncServerSettings } from './SyncServerSettings'

const URL_OK = 'https://abcdefgh.supabase.co'
const PUBLISHABLE = 'sb_publishable_madeUpKey123'

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
/** A made-up server where sync is set up. */
const workingServer = vi.fn(async (input: string) =>
  input.includes('/auth/v1/settings') ? json(200, {}) : json(401, { code: '42501', message: 'permission denied' }),
)

beforeEach(async () => {
  localStorage.clear()
  workingServer.mockClear()
  await db.delete()
  await db.open()
})

afterEach(async () => {
  cleanup()
  localStorage.clear()
  db.close()
  await db.delete()
})

async function fill(url: string, key: string) {
  await userEvent.type(await screen.findByLabelText('Server address (Project URL)'), url)
  await userEvent.type(screen.getByLabelText('Public key (publishable or anon key)'), key)
}

describe('SyncServerSettings', () => {
  it('connects your own server: test first, then save and restart', async () => {
    const restart = vi.fn()
    render(<SyncServerSettings database={db} fetchFn={workingServer} restart={restart} />)
    expect(screen.getByText(/No server connected: sync is off/)).toBeInTheDocument()

    await fill(URL_OK, PUBLISHABLE)
    const save = screen.getByRole('button', { name: 'Save and restart' })
    expect(save).toBeDisabled()

    await userEvent.click(screen.getByRole('button', { name: 'Test connection' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Connection works and sync is set up on this server.')
    await userEvent.click(save)

    await waitFor(() => expect(restart).toHaveBeenCalledOnce())
    expect(JSON.parse(localStorage.getItem(SYNC_SERVER_KEY)!)).toEqual({ url: URL_OK, publicKey: PUBLISHABLE })
  })

  it('needs a new test after the values change', async () => {
    render(<SyncServerSettings database={db} fetchFn={workingServer} restart={vi.fn()} />)
    await fill(URL_OK, PUBLISHABLE)
    await userEvent.click(screen.getByRole('button', { name: 'Test connection' }))
    await screen.findByRole('status')
    await userEvent.type(screen.getByLabelText('Public key (publishable or anon key)'), 'X')
    expect(screen.getByRole('button', { name: 'Save and restart' })).toBeDisabled()
  })

  it('refuses a secret key without contacting the server', async () => {
    render(<SyncServerSettings database={db} fetchFn={workingServer} restart={vi.fn()} />)
    await fill(URL_OK, 'sb_secret_madeUpKey123')
    await userEvent.click(screen.getByRole('button', { name: 'Test connection' }))
    expect(screen.getByRole('alert')).toHaveTextContent(/SECRET key/)
    expect(workingServer).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Save and restart' })).toBeDisabled()
  })

  it('explains a server where sync is not set up yet', async () => {
    const notSetUp = async (input: string) => (input.includes('/auth/v1/settings') ? json(200, {}) : json(404, { code: 'PGRST205' }))
    render(<SyncServerSettings database={db} fetchFn={notSetUp} restart={vi.fn()} />)
    await fill(URL_OK, PUBLISHABLE)
    await userEvent.click(screen.getByRole('button', { name: 'Test connection' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('sync is not set up on it yet')
    expect(screen.getByRole('button', { name: 'Save and restart' })).toBeDisabled()
  })

  it('does not allow changing the server while this device is linked to a sync account', async () => {
    const keys = await createKeys('correct horse battery staple', { iterations: MIN_PBKDF2_ITERATIONS })
    await linkDevice(db, { userId: 'user-1', dataKey: keys.dataKey, keyVersion: 1 })
    render(<SyncServerSettings database={db} fetchFn={workingServer} restart={vi.fn()} />)
    expect(await screen.findByText('To change the server, sign out first. Your data stays on this device.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Server address (Project URL)')).not.toBeInTheDocument()
  })

  it('re-checks the link when saving (linked in the meantime: nothing saved)', async () => {
    const restart = vi.fn()
    render(<SyncServerSettings database={db} fetchFn={workingServer} restart={restart} />)
    await fill(URL_OK, PUBLISHABLE)
    await userEvent.click(screen.getByRole('button', { name: 'Test connection' }))
    await screen.findByRole('status')

    const keys = await createKeys('correct horse battery staple', { iterations: MIN_PBKDF2_ITERATIONS })
    await linkDevice(db, { userId: 'user-1', dataKey: keys.dataKey, keyVersion: 1 })
    await userEvent.click(screen.getByRole('button', { name: 'Save and restart' }))

    expect(await screen.findByText(/To change the server, sign out first/)).toBeInTheDocument()
    expect(restart).not.toHaveBeenCalled()
    expect(localStorage.getItem(SYNC_SERVER_KEY)).toBeNull()
  })

  it('shows your saved server and can forget it', async () => {
    localStorage.setItem(SYNC_SERVER_KEY, JSON.stringify({ url: URL_OK, publicKey: PUBLISHABLE }))
    const restart = vi.fn()
    render(<SyncServerSettings database={db} fetchFn={workingServer} restart={restart} />)
    expect(screen.getByText('This device uses your own server (abcdefgh.supabase.co).')).toBeInTheDocument()
    await userEvent.click(await screen.findByRole('button', { name: 'Forget my server' }))
    await waitFor(() => expect(restart).toHaveBeenCalledOnce())
    expect(localStorage.getItem(SYNC_SERVER_KEY)).toBeNull()
  })
})
