// "Test connection" (sharing plan S1) against the LOCAL Supabase stack:
// checks the answers the app relies on to tell a set-up server from one
// where the setup SQL was not run.
import { describe, expect, inject, it } from 'vitest'

import { checkServerConfig, testServerConnection } from './serverConfig'

describe('testServerConnection (local Supabase)', () => {
  it('accepts the local server with its public key: reachable, key accepted, sync tables present', async () => {
    const { url, publicKey } = inject('supabase')
    const check = checkServerConfig(url, publicKey)
    expect(check.ok).toBe(true)
    if (!check.ok) return
    expect(await testServerConnection(check.config)).toEqual({ status: 'ok' })
  })

  it('a missing table answers 404 / PGRST205 (what "not set up yet" relies on)', async () => {
    const { url, publicKey } = inject('supabase')
    const response = await fetch(`${url}/rest/v1/table_that_does_not_exist?select=id&limit=1`, { headers: { apikey: publicKey } })
    expect(response.status).toBe(404)
    expect(((await response.json()) as { code: string }).code).toBe('PGRST205')
  })

  // Not testable here: the local stack accepts ANY key (checked 2026-11-21:
  // a made-up key, "garbage" and no key all get answers). Hosted Supabase
  // answers 401 "Invalid API key", which the app reports as "key refused"
  // (unit-tested with a fake server; to verify by hand on a hosted server).
})
