/**
 * In-memory sync backend for interface tests: fake email-code sign-in on
 * top of the in-memory server. Test-only: never imported by the app.
 */

import type { SyncBackend, SyncUser } from '../backendTypes'
import type { KeyEnvelope } from '../crypto'
import { createMemoryServer, type MemoryServer } from './memoryServer'

export const TEST_CODE = '123456'

export interface MemoryBackend extends SyncBackend {
  server: MemoryServer
  sentCodesTo: string[]
}

export function createMemoryBackend(
  options: { userId?: string; signedInAs?: SyncUser | null; envelope?: KeyEnvelope | null } = {},
): MemoryBackend {
  const userId = options.userId ?? 'user-1'
  let user: SyncUser | null = options.signedInAs ?? null
  const server = createMemoryServer(userId, options.envelope ?? null)
  server.signedInAs = user?.id ?? null
  const sentCodesTo: string[] = []

  return {
    server,
    sentCodesTo,
    isLocalTestServer: false,
    auth: {
      async getUser() {
        return user
      },
      async sendCode(email) {
        sentCodesTo.push(email)
      },
      async verifyCode(email, code) {
        if (code.trim() !== TEST_CODE) {
          throw new Error('That code is wrong or has expired. Request a new code and try again.')
        }
        user = { id: userId, email: email.trim() }
        server.signedInAs = userId
        return user
      },
      async signOut() {
        user = null
        server.signedInAs = null
      },
    },
  }
}
