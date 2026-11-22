/**
 * Sign-in and server access for synchronisation (docs/SYNC_DESIGN.md §7, §9).
 *
 * The app talks to Supabase only through SyncBackend, so the interface
 * can be tested with an in-memory backend. Sync stays switched off when
 * there is no server: none saved on this device (serverConfig.ts) and none
 * built in (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).
 * Only the PUBLIC key is ever used here.
 */

import { createClient } from '@supabase/supabase-js'
import { messages } from '../i18n'

import { LOCAL_MAILBOX_URL, isPlausibleEmail, type SyncAuth, type SyncBackend, type SyncUser } from './backendTypes'
import { createSupabaseSyncServer } from './server'
import { resolveServer, type BuiltInEnv } from './serverConfig'

export { LOCAL_MAILBOX_URL, isPlausibleEmail }
export type { SyncAuth, SyncBackend, SyncUser }

/** The message shown when the email has no account (in the current language). */
export function noAccountMessage(): string {
  return messages().syncText.noAccount
}

export function readableAuthError(error: { message?: string; status?: number; code?: string }): Error {
  const message = error.message ?? ''
  // New accounts are refused (security review 2026-11-12): by the app
  // (shouldCreateUser false) and, on the hosted project, by the server.
  if (error.code === 'otp_disabled' || error.code === 'signup_disabled' || /signups? not allowed/i.test(message)) {
    return new Error(noAccountMessage())
  }
  if (/expired|invalid/i.test(message)) {
    return new Error(messages().syncText.wrongCode)
  }
  if (/fetch|network/i.test(message)) {
    return new Error(messages().syncText.unreachable)
  }
  if (/security purposes|rate limit|too many/i.test(message)) {
    return new Error(messages().syncText.wait(message))
  }
  return new Error(message || messages().syncText.signInFailed)
}

function userOf(user: { id: string; email?: string } | null | undefined): SyncUser | null {
  return user ? { id: user.id, email: user.email ?? '' } : null
}

export function createSupabaseBackend(url: string, publicKey: string): SyncBackend {
  const client = createClient(url, publicKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  })

  const auth: SyncAuth = {
    async getUser() {
      const { data, error } = await client.auth.getSession()
      if (error) throw readableAuthError(error)
      return userOf(data.session?.user)
    },

    async sendCode(email) {
      // Never creates an account: the sync server is for its owner only
      // (security review 2026-11-12). Accounts are created in the
      // Supabase dashboard if ever needed.
      const { error } = await client.auth.signInWithOtp({
        email: email.trim(),
        options: { shouldCreateUser: false },
      })
      if (error) throw readableAuthError(error)
    },

    async verifyCode(email, code) {
      const { data, error } = await client.auth.verifyOtp({
        email: email.trim(),
        token: code.trim(),
        type: 'email',
      })
      if (error) throw readableAuthError(error)
      const user = userOf(data.user)
      if (!user) throw new Error(messages().syncText.signInFailed)
      return user
    },

    async signOut() {
      // "local": only this device; other devices stay signed in.
      const { error } = await client.auth.signOut({ scope: 'local' })
      if (error) throw readableAuthError(error)
    },
  }

  const host = new URL(url).hostname
  return {
    auth,
    server: createSupabaseSyncServer(client),
    isLocalTestServer: host === '127.0.0.1' || host === 'localhost',
  }
}

/** The backend for this device's server (saved or built in), or null (sync switched off). */
export function createConfiguredBackend(env: BuiltInEnv = import.meta.env): SyncBackend | null {
  const server = resolveServer(env)
  return server ? createSupabaseBackend(server.config.url, server.config.publicKey) : null
}
