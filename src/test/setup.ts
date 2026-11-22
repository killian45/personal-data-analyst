import 'fake-indexeddb/auto'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach } from 'vitest'

import { FEATURES_STORAGE_KEY, resetFeaturesCache } from '../settings/features'
import { WELCOME_DONE_KEY } from '../settings/welcome'

// jsdom has no ResizeObserver; Recharts' ResponsiveContainer needs one.
// Tests check numbers through tiles and data tables, not chart pixels.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver

// Tests never talk to a real Ollama on the developer's computer (Phase 6
// step 5): requests to it fail as if it were not running, unless a test
// stubs fetch itself.
const realFetch = globalThis.fetch?.bind(globalThis)
if (realFetch) {
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.startsWith('http://127.0.0.1:11434')) return Promise.reject(new TypeError('Ollama is blocked in tests'))
    return realFetch(input, init)
  }) as typeof fetch
}

// The welcome screen (sharing plan S4) appears only on a brand-new device;
// tests start as an existing device (welcome done, every feature on)
// unless they change it. Node-only tests have no localStorage.
beforeEach(() => {
  globalThis.localStorage?.setItem(WELCOME_DONE_KEY, '1')
})

afterEach(() => {
  globalThis.localStorage?.removeItem(FEATURES_STORAGE_KEY)
  resetFeaturesCache()
})
