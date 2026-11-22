import { afterEach, describe, expect, it } from 'vitest'

import { createConfiguredBackend, noAccountMessage, readableAuthError } from './backend'
import { isSyncConfigured } from './backendTypes'
import { SYNC_SERVER_KEY } from './serverConfig'

describe('readableAuthError', () => {
  it('explains that new accounts are refused (app or server setting)', () => {
    expect(readableAuthError({ message: 'Signups not allowed for otp', code: 'otp_disabled' }).message).toBe(noAccountMessage())
    expect(readableAuthError({ message: 'Signups not allowed for this instance', code: 'signup_disabled' }).message).toBe(noAccountMessage())
    expect(readableAuthError({ message: 'Signup not allowed' }).message).toBe(noAccountMessage())
  })

  it('keeps the other messages', () => {
    expect(readableAuthError({ message: 'Token has expired or is invalid' }).message).toBe('That code is wrong or has expired. Request a new code and try again.')
    expect(readableAuthError({ message: 'Failed to fetch' }).message).toBe('Could not reach the sync server. Check your connection and try again.')
    expect(readableAuthError({}).message).toBe('Sign-in failed.')
  })
})

describe('which server the app connects to', () => {
  afterEach(() => localStorage.clear())
  const builtIn = { VITE_SUPABASE_URL: 'https://built-in.supabase.co', VITE_SUPABASE_ANON_KEY: 'built-in-key' }

  it('uses the built-in server when none is saved (the owner\'s devices, unchanged)', () => {
    expect(isSyncConfigured(builtIn)).toBe(true)
    expect(createConfiguredBackend(builtIn)?.isLocalTestServer).toBe(false)
    expect(isSyncConfigured({})).toBe(false)
    expect(createConfiguredBackend({})).toBeNull()
  })

  it('uses the server saved on this device, even without a built-in one', () => {
    localStorage.setItem(SYNC_SERVER_KEY, JSON.stringify({ url: 'http://127.0.0.1:54321', publicKey: 'sb_publishable_madeUp' }))
    expect(isSyncConfigured({})).toBe(true)
    expect(createConfiguredBackend(builtIn)?.isLocalTestServer).toBe(true)
  })
})
