import { messages } from '../i18n'

/**
 * Which sync server this device uses (sharing plan S1, docs/SHARING_PLAN.md).
 *
 * A server saved on this device ("Connect your own server") takes
 * priority; otherwise the server built into the app (VITE_SUPABASE_URL /
 * VITE_SUPABASE_ANON_KEY), as before. Saved per device in localStorage:
 * never synchronised (sync needs it first) and not in backups.
 *
 * Only a PUBLIC key is accepted. A Supabase secret / service-role key
 * gives full access to the server and must never be in an app: it is
 * refused with an explanation.
 */

export const SYNC_SERVER_KEY = 'pda.syncServer'

export interface SyncServerConfig {
  /** Server address, normalised to its origin (e.g. https://abc.supabase.co). */
  url: string
  publicKey: string
}

export type ServerSource = 'saved' | 'built-in'

export type ServerCheck = { ok: true; config: SyncServerConfig } | { ok: false; error: string }

export interface BuiltInEnv {
  VITE_SUPABASE_URL?: string
  VITE_SUPABASE_ANON_KEY?: string
}

type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost'])

/** The "role" claim of an older Supabase key (a JWT), or null. */
function jwtRole(key: string): string | null {
  const parts = key.split('.')
  if (parts.length !== 3) return null
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const payload: unknown = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')))
    if (payload && typeof payload === 'object' && 'role' in payload && typeof payload.role === 'string') {
      return payload.role
    }
    return null
  } catch {
    return null
  }
}

/**
 * Checks what the person typed. The address must be https (plain http only
 * for a test server on this computer); the key must be a public key.
 */
export function checkServerConfig(urlText: string, keyText: string): ServerCheck {
  const urlInput = urlText.trim()
  const key = keyText.trim()
  if (!urlInput) return { ok: false, error: messages().syncText.server.enterUrl }
  let url: URL
  try {
    url = new URL(urlInput)
  } catch {
    return { ok: false, error: messages().syncText.server.invalidUrl }
  }
  const local = LOCAL_HOSTS.has(url.hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    return { ok: false, error: messages().syncText.server.https }
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    return { ok: false, error: messages().syncText.server.onlyAddress }
  }

  if (!key) return { ok: false, error: messages().syncText.server.enterKey }
  const role = jwtRole(key)
  if (key.startsWith('sb_secret_') || role === 'service_role') {
    return {
      ok: false,
      error:
        messages().syncText.server.secretKey,
    }
  }
  if (!key.startsWith('sb_publishable_') && role !== 'anon') {
    return { ok: false, error: messages().syncText.server.notPublic }
  }
  return { ok: true, config: { url: url.origin, publicKey: key } }
}

function defaultStorage(): KeyValueStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

/** The server saved on this device, or null (none, or unreadable). */
export function loadSavedServer(storage: KeyValueStorage | null = defaultStorage()): SyncServerConfig | null {
  const text = storage?.getItem(SYNC_SERVER_KEY)
  if (!text) return null
  try {
    const value: unknown = JSON.parse(text)
    if (!value || typeof value !== 'object' || !('url' in value) || !('publicKey' in value)) return null
    if (typeof value.url !== 'string' || typeof value.publicKey !== 'string') return null
    const check = checkServerConfig(value.url, value.publicKey)
    return check.ok ? check.config : null
  } catch {
    return null
  }
}

export function saveServer(config: SyncServerConfig, storage: KeyValueStorage | null = defaultStorage()): void {
  const check = checkServerConfig(config.url, config.publicKey)
  if (!check.ok) throw new Error(check.error)
  if (!storage) throw new Error(messages().syncText.server.cannotStore)
  storage.setItem(SYNC_SERVER_KEY, JSON.stringify(check.config))
}

export function forgetSavedServer(storage: KeyValueStorage | null = defaultStorage()): void {
  storage?.removeItem(SYNC_SERVER_KEY)
}

/** The server built into this version of the app, or null. Unchanged rules (any valid address). */
export function builtInServer(env: BuiltInEnv): SyncServerConfig | null {
  const url = env.VITE_SUPABASE_URL?.trim()
  const publicKey = env.VITE_SUPABASE_ANON_KEY?.trim()
  if (!url || !publicKey) return null
  try {
    new URL(url)
  } catch {
    return null
  }
  return { url, publicKey }
}

/** The server this device uses: the saved one first, then the built-in one. */
export function resolveServer(
  env: BuiltInEnv = import.meta.env,
  storage: KeyValueStorage | null = defaultStorage(),
): { config: SyncServerConfig; source: ServerSource } | null {
  const saved = loadSavedServer(storage)
  if (saved) return { config: saved, source: 'saved' }
  const builtIn = builtInServer(env)
  return builtIn ? { config: builtIn, source: 'built-in' } : null
}

export type ConnectionResult =
  | { status: 'ok' }
  | { status: 'unreachable' | 'not-supabase' | 'key-refused' | 'not-set-up' | 'unexpected'; message: string }

type Fetch = (input: string, init?: RequestInit) => Promise<Response>

/**
 * "Test connection": 1. the server answers as a Supabase project and
 * accepts the key; 2. the sync tables exist (the setup SQL was run).
 * Without signing in, the table answers "permission denied" when it
 * exists (only signed-in users may read it) and "not found" when not.
 */
export async function testServerConnection(config: SyncServerConfig, fetchFn: Fetch = fetch): Promise<ConnectionResult> {
  const headers = { apikey: config.publicKey }
  let settings: Response
  try {
    settings = await fetchFn(`${config.url}/auth/v1/settings`, { headers })
  } catch {
    return { status: 'unreachable', message: messages().syncText.server.unreachable }
  }
  if (settings.status === 401 || settings.status === 403) {
    return { status: 'key-refused', message: messages().syncText.server.keyRefused }
  }
  if (!settings.ok) {
    return { status: 'not-supabase', message: messages().syncText.server.notSupabase(settings.status) }
  }

  let table: Response
  try {
    table = await fetchFn(`${config.url}/rest/v1/user_keys?select=user_id&limit=1`, { headers })
  } catch {
    return { status: 'unreachable', message: messages().syncText.server.unreachable }
  }
  if (table.ok) return { status: 'ok' }
  const body: unknown = await table.json().catch(() => null)
  const code = body && typeof body === 'object' && 'code' in body ? String(body.code) : ''
  if (code === '42501') return { status: 'ok' }
  if (table.status === 404 || code === 'PGRST205' || code === '42P01') {
    return {
      status: 'not-set-up',
      message: messages().syncText.server.notSetUp,
    }
  }
  if (table.status === 401 && !code) {
    return { status: 'key-refused', message: messages().syncText.server.keyRefused }
  }
  return { status: 'unexpected', message: messages().syncText.server.unexpected(table.status, code ?? null) }
}
