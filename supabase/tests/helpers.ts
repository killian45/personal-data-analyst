import { randomBytes, randomUUID } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { inject } from 'vitest'

export interface TestUser {
  id: string
  client: SupabaseClient
}

function newClient(): SupabaseClient {
  const { url, publicKey } = inject('supabase')
  return createClient(url, publicKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}

/** A client with no signed-in user (an anonymous visitor). */
export function anonymousClient(): SupabaseClient {
  return newClient()
}

/**
 * Creates a fresh signed-in test user on the local stack.
 * (The app signs in by email code; tests use a password because the local
 * stack does not require email confirmation.)
 */
export async function createTestUser(): Promise<TestUser> {
  const client = newClient()
  const { data, error } = await client.auth.signUp({
    email: `sync-test-${randomUUID()}@example.com`,
    password: randomBytes(18).toString('base64url'),
  })
  if (error) throw error
  if (!data.user || !data.session) throw new Error('Sign-up returned no session')
  return { id: data.user.id, client }
}

/** PostgREST representation of a bytea value. */
export function hex(bytes: Uint8Array): string {
  return `\\x${Buffer.from(bytes).toString('hex')}`
}

export function randomHex(length: number): string {
  return hex(randomBytes(length))
}

export interface PushArgs {
  collection?: string
  recordId?: string
  expectedRevision: number | null
  revision: number
  ciphertext?: string
  iv?: string
  keyVersion?: number
}

export type PushResult =
  | { status: 'ok'; revision: number; server_seq: number; server_updated_at: string }
  | { status: 'conflict'; current: ServerRow | null }

export interface ServerRow {
  collection: string
  record_id: string
  revision: number
  ciphertext: string
  iv: string
  key_version: number
  server_seq: number
  server_updated_at: string
}

export function push(client: SupabaseClient, args: PushArgs) {
  return client.rpc('push_record', {
    p_collection: args.collection ?? 'habits',
    p_record_id: args.recordId ?? randomUUID(),
    p_expected_revision: args.expectedRevision,
    p_revision: args.revision,
    p_ciphertext: args.ciphertext ?? randomHex(64),
    p_iv: args.iv ?? randomHex(12),
    p_key_version: args.keyVersion ?? 1,
  }) as unknown as Promise<{ data: PushResult | null; error: { code: string; message: string } | null }>
}

/** Pushes and fails the test unless the server accepted the upload. */
export async function pushOk(client: SupabaseClient, args: PushArgs) {
  const { data, error } = await push(client, args)
  if (error) throw new Error(`push_record failed: ${error.code} ${error.message}`)
  if (data?.status !== 'ok') throw new Error(`push_record returned ${JSON.stringify(data)}`)
  return data
}

export function userKeyRow() {
  return {
    wrapped_key_pass: randomHex(40),
    wrapped_key_rec: randomHex(40),
    salt: randomHex(16),
    iterations: 600_000,
    key_version: 1,
  }
}
