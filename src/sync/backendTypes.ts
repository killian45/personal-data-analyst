/**
 * Sign-in and server access types for synchronisation. Kept separate from
 * backend.ts so the interface can use them without loading the Supabase
 * library (which is loaded on demand).
 */

import { resolveServer, type BuiltInEnv } from './serverConfig'
import type { SyncServer } from './server'

export interface SyncUser {
  id: string
  email: string
}

export interface SyncAuth {
  /** The signed-in user on this device, or null. */
  getUser(): Promise<SyncUser | null>
  /** Emails a 6-digit sign-in code (creates the account if needed). */
  sendCode(email: string): Promise<void>
  /** Signs in with the emailed code. Throws a readable Error if wrong. */
  verifyCode(email: string, code: string): Promise<SyncUser>
  signOut(): Promise<void>
}

export interface SyncBackend {
  auth: SyncAuth
  server: SyncServer
  /** True for the local test server on this computer (codes go to Mailpit). */
  isLocalTestServer: boolean
}

export const LOCAL_MAILBOX_URL = 'http://127.0.0.1:54324'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function isPlausibleEmail(email: string): boolean {
  return EMAIL.test(email.trim())
}

/**
 * True when this device has a sync server: one saved on this device
 * ("Connect your own server") or the one built into the app.
 */
export function isSyncConfigured(env: BuiltInEnv = import.meta.env): boolean {
  return resolveServer(env) !== null
}
