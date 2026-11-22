import { execFileSync } from 'node:child_process'
import type { TestProject } from 'vitest/node'

export interface LocalSupabase {
  url: string
  publicKey: string
}

declare module 'vitest' {
  export interface ProvidedContext {
    supabase: LocalSupabase
  }
}

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost'])

/**
 * Reads the address and PUBLIC key of the running local Supabase stack.
 * Refuses anything that is not on this computer, so these tests can never
 * create test users in the real (Paris) project.
 */
export function setup(project: TestProject): void {
  let raw: string
  try {
    raw = execFileSync('npx', ['supabase', 'status', '-o', 'json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch {
    throw new Error(
      'The local Supabase stack is not running. Start it with "npm run db:start", then retry.',
    )
  }

  const status = JSON.parse(raw.slice(raw.indexOf('{'))) as Record<string, unknown>
  const url = status.API_URL
  const publicKey = status.PUBLISHABLE_KEY ?? status.ANON_KEY
  if (typeof url !== 'string' || typeof publicKey !== 'string') {
    throw new Error('Could not read API_URL and the public key from "supabase status".')
  }
  if (!LOCAL_HOSTS.has(new URL(url).hostname)) {
    throw new Error(`Refusing to run database tests against a non-local Supabase: ${url}`)
  }

  project.provide('supabase', { url, publicKey })
}
