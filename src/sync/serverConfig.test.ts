import { describe, expect, it } from 'vitest'

import {
  SYNC_SERVER_KEY,
  checkServerConfig,
  forgetSavedServer,
  loadSavedServer,
  resolveServer,
  saveServer,
  testServerConnection,
} from './serverConfig'

/** A made-up older-style Supabase key (JWT) with the given role. */
function fakeJwt(role: string): string {
  const part = (value: object) => btoa(JSON.stringify(value)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
  return `${part({ alg: 'HS256', typ: 'JWT' })}.${part({ iss: 'supabase', ref: 'abcdefgh', role })}.c2lnbmF0dXJl`
}

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  }
}

const URL_OK = 'https://abcdefgh.supabase.co'
const PUBLISHABLE = 'sb_publishable_madeUpKey123'

describe('checkServerConfig', () => {
  it('accepts an https address with a publishable or anon key, normalised to the origin', () => {
    expect(checkServerConfig(` ${URL_OK}/ `, ` ${PUBLISHABLE} `)).toEqual({ ok: true, config: { url: URL_OK, publicKey: PUBLISHABLE } })
    expect(checkServerConfig(URL_OK, fakeJwt('anon'))).toMatchObject({ ok: true })
  })

  it('accepts plain http only for a test server on this computer', () => {
    expect(checkServerConfig('http://127.0.0.1:54321', PUBLISHABLE)).toMatchObject({ ok: true, config: { url: 'http://127.0.0.1:54321' } })
    expect(checkServerConfig('http://localhost:54321', PUBLISHABLE)).toMatchObject({ ok: true })
    expect(checkServerConfig('http://abcdefgh.supabase.co', PUBLISHABLE)).toEqual({ ok: false, error: 'The server address must start with https://' })
  })

  it('refuses empty, invalid or over-long addresses', () => {
    expect(checkServerConfig('', PUBLISHABLE)).toMatchObject({ ok: false, error: 'Enter the server address (Project URL).' })
    expect(checkServerConfig('abcdefgh.supabase.co', PUBLISHABLE)).toMatchObject({ ok: false, error: expect.stringContaining('not a valid web address') })
    expect(checkServerConfig(`${URL_OK}/rest/v1`, PUBLISHABLE)).toMatchObject({ ok: false, error: expect.stringContaining('without anything after the name') })
  })

  it('refuses secret keys of both kinds, with an explanation', () => {
    for (const secret of ['sb_secret_madeUpKey123', fakeJwt('service_role')]) {
      const result = checkServerConfig(URL_OK, secret)
      expect(result).toMatchObject({ ok: false, error: expect.stringContaining('SECRET key') })
    }
  })

  it('refuses a missing key or something that is not a Supabase public key', () => {
    expect(checkServerConfig(URL_OK, '')).toMatchObject({ ok: false, error: expect.stringContaining('Enter the public key') })
    expect(checkServerConfig(URL_OK, 'hello')).toMatchObject({ ok: false, error: expect.stringContaining('does not look like') })
    expect(checkServerConfig(URL_OK, fakeJwt('authenticated'))).toMatchObject({ ok: false, error: expect.stringContaining('does not look like') })
    expect(checkServerConfig(URL_OK, 'a.!!!.c')).toMatchObject({ ok: false })
  })
})

describe('saved server and which server is used', () => {
  it('saves, reads back and forgets the server on this device', () => {
    const storage = memoryStorage()
    expect(loadSavedServer(storage)).toBeNull()
    saveServer({ url: `${URL_OK}/`, publicKey: PUBLISHABLE }, storage)
    expect(JSON.parse(storage.data.get(SYNC_SERVER_KEY)!)).toEqual({ url: URL_OK, publicKey: PUBLISHABLE })
    expect(loadSavedServer(storage)).toEqual({ url: URL_OK, publicKey: PUBLISHABLE })
    forgetSavedServer(storage)
    expect(loadSavedServer(storage)).toBeNull()
  })

  it('never saves a secret key', () => {
    const storage = memoryStorage()
    expect(() => saveServer({ url: URL_OK, publicKey: 'sb_secret_x' }, storage)).toThrow(/SECRET key/)
    expect(storage.data.size).toBe(0)
  })

  it('ignores an unreadable or invalid saved value', () => {
    expect(loadSavedServer(memoryStorage({ [SYNC_SERVER_KEY]: 'not json' }))).toBeNull()
    expect(loadSavedServer(memoryStorage({ [SYNC_SERVER_KEY]: '{"url":1}' }))).toBeNull()
    expect(loadSavedServer(memoryStorage({ [SYNC_SERVER_KEY]: JSON.stringify({ url: URL_OK, publicKey: 'sb_secret_x' }) }))).toBeNull()
  })

  it('uses the saved server first, then the built-in one, else none', () => {
    const builtIn = { VITE_SUPABASE_URL: 'https://built-in.supabase.co', VITE_SUPABASE_ANON_KEY: 'built-in-key' }
    // The owner's devices: nothing saved -> the built-in server, exactly as before.
    expect(resolveServer(builtIn, memoryStorage())).toEqual({ source: 'built-in', config: { url: 'https://built-in.supabase.co', publicKey: 'built-in-key' } })

    const storage = memoryStorage()
    saveServer({ url: URL_OK, publicKey: PUBLISHABLE }, storage)
    expect(resolveServer(builtIn, storage)).toEqual({ source: 'saved', config: { url: URL_OK, publicKey: PUBLISHABLE } })
    expect(resolveServer({}, storage)).toMatchObject({ source: 'saved' })

    expect(resolveServer({}, memoryStorage())).toBeNull()
    expect(resolveServer({ VITE_SUPABASE_URL: 'not a url', VITE_SUPABASE_ANON_KEY: 'k' }, memoryStorage())).toBeNull()
    expect(resolveServer(builtIn, null)).toMatchObject({ source: 'built-in' })
  })
})

describe('testServerConnection', () => {
  const config = { url: URL_OK, publicKey: PUBLISHABLE }
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

  function fakeFetch(settings: () => Response, table: () => Response) {
    const calls: { url: string; apikey: string | null }[] = []
    const fetchFn = async (input: string, init?: RequestInit) => {
      calls.push({ url: input, apikey: new Headers(init?.headers).get('apikey') })
      return input.includes('/auth/v1/settings') ? settings() : table()
    }
    return { fetchFn, calls }
  }

  it('is ok when the server accepts the key and the sync table exists (permission denied without sign-in)', async () => {
    const { fetchFn, calls } = fakeFetch(() => json(200, {}), () => json(401, { code: '42501', message: 'permission denied for table user_keys' }))
    expect(await testServerConnection(config, fetchFn)).toEqual({ status: 'ok' })
    expect(calls).toEqual([
      { url: `${URL_OK}/auth/v1/settings`, apikey: PUBLISHABLE },
      { url: `${URL_OK}/rest/v1/user_keys?select=user_id&limit=1`, apikey: PUBLISHABLE },
    ])
  })

  it('says when the setup SQL has not been run', async () => {
    const { fetchFn } = fakeFetch(() => json(200, {}), () => json(404, { code: 'PGRST205', message: "Could not find the table 'public.user_keys'" }))
    expect(await testServerConnection(config, fetchFn)).toMatchObject({ status: 'not-set-up' })
  })

  it('says when the key is refused, the address is wrong or the server cannot be reached', async () => {
    expect(await testServerConnection(config, fakeFetch(() => json(401, { message: 'Invalid API key' }), () => json(200, [])).fetchFn)).toMatchObject({ status: 'key-refused' })
    expect(await testServerConnection(config, fakeFetch(() => new Response('nope', { status: 404 }), () => json(200, [])).fetchFn)).toMatchObject({ status: 'not-supabase', message: expect.stringContaining('error 404') })
    const offline = async () => { throw new TypeError('Failed to fetch') }
    expect(await testServerConnection(config, offline)).toMatchObject({ status: 'unreachable' })
    expect(await testServerConnection(config, fakeFetch(() => json(200, {}), () => json(500, { code: 'XX000' })).fetchFn)).toMatchObject({ status: 'unexpected', message: expect.stringContaining('500, XX000') })
  })
})
