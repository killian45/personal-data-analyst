// End-to-end: sign-in by emailed 6-digit code against the LOCAL Supabase
// stack; the code is read from the local test mailbox (Mailpit).
import { createClient } from '@supabase/supabase-js'
import { describe, expect, inject, it } from 'vitest'

import { createSupabaseBackend, LOCAL_MAILBOX_URL, noAccountMessage } from './backend'

declare module 'vitest' {
  export interface ProvidedContext {
    supabase: { url: string; publicKey: string }
  }
}

async function latestCodeFor(email: string): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const search = await fetch(`${LOCAL_MAILBOX_URL}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)
    const { messages } = (await search.json()) as { messages: { ID: string }[] }
    if (messages.length > 0) {
      const message = (await (await fetch(`${LOCAL_MAILBOX_URL}/api/v1/message/${messages[0].ID}`)).json()) as {
        Subject: string
        Text: string
      }
      expect(message.Subject).toBe('Your Personal Data Analyst sign-in code')
      const code = message.Text.match(/\b(\d{6})\b/)
      if (code) return code[1]
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`No sign-in code arrived for ${email}`)
}

describe('sign-in by email code (local Supabase)', () => {
  it('sends a 6-digit code, refuses a wrong one, and signs in with the right one', async () => {
    const { url, publicKey } = inject('supabase')
    const backend = createSupabaseBackend(url, publicKey)
    const email = `sign-in-${crypto.randomUUID()}@example.com`
    // The app never creates accounts: make one the way the owner's exists.
    const admin = createClient(url, publicKey, { auth: { persistSession: false } })
    const { error: signUpError } = await admin.auth.signUp({ email, password: crypto.randomUUID() })
    expect(signUpError).toBeNull()

    expect(backend.isLocalTestServer).toBe(true)
    expect(await backend.auth.getUser()).toBeNull()

    await backend.auth.sendCode(email)
    const code = await latestCodeFor(email)

    const wrong = code === '000000' ? '111111' : '000000'
    await expect(backend.auth.verifyCode(email, wrong)).rejects.toThrow('That code is wrong or has expired')

    const user = await backend.auth.verifyCode(email, code)
    expect(user.email).toBe(email)
    expect(await backend.auth.getUser()).toEqual(user)
    expect(await backend.server.currentUserId()).toBe(user.id)
    expect(await backend.server.getKeyEnvelope()).toBeNull()

    await backend.auth.signOut()
    expect(await backend.auth.getUser()).toBeNull()
  })

  it('refuses an email without an account, with a clear message, and creates no account', async () => {
    const { url, publicKey } = inject('supabase')
    const backend = createSupabaseBackend(url, publicKey)
    const email = `stranger-${crypto.randomUUID()}@example.com`

    await expect(backend.auth.sendCode(email)).rejects.toThrow(noAccountMessage())
    // No code was sent, so nobody can sign in as this email.
    const search = await fetch(`${LOCAL_MAILBOX_URL}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)
    expect(((await search.json()) as { messages: unknown[] }).messages).toEqual([])
  })
})
