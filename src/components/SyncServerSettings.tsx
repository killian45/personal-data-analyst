import { lazy, Suspense, useEffect, useId, useState } from 'react'

import type { PersonalDataDatabase } from '../database/db'
import { messages } from '../i18n'

// The step-by-step guide (S5) and its setup SQL load only when opened.
const ServerGuide = lazy(() => import('./ServerGuide'))

import {
  checkServerConfig,
  forgetSavedServer,
  resolveServer,
  saveServer,
  testServerConnection,
  type ConnectionResult,
  type SyncServerConfig,
} from '../sync/serverConfig'

/**
 * "Sync server" (sharing plan S1): shows which server this device uses
 * and lets the person connect their own Supabase project. Changing the
 * server is only possible while this device is not linked to a sync
 * account (sign out first: signing out marks every record "not yet
 * sent", so a new server receives everything). The app restarts after a
 * change, because the connection is made when the app starts.
 */

interface SyncServerSettingsProps {
  database: PersonalDataDatabase
  /** Changes when the link may have changed (re-reads it). */
  linkKey?: unknown
  /** Tests only. */
  fetchFn?: (input: string, init?: RequestInit) => Promise<Response>
  /** Restarts the app so the new server is used. */
  restart?: () => void
}

const inputClass = 'mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm'
const primaryButton =
  'rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50'
const secondaryButton =
  'rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50'

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/** Whether this device is linked to a sync account (undefined while reading). */
async function isLinked(database: PersonalDataDatabase): Promise<boolean> {
  return (await database.syncState.get('current')) !== undefined
}

export function SyncServerSettings({ database, linkKey, fetchFn, restart = () => window.location.reload() }: SyncServerSettingsProps) {
  const id = useId()
  const [guideOpen, setGuideOpen] = useState(false)
  const current = resolveServer()
  const [linked, setLinked] = useState<boolean | undefined>(undefined)
  useEffect(() => {
    let cancelled = false
    // Unreadable: treated as linked, so nothing can be changed.
    isLinked(database).then(
      (value) => { if (!cancelled) setLinked(value) },
      () => { if (!cancelled) setLinked(true) },
    )
    return () => { cancelled = true }
  }, [database, linkKey])
  const [url, setUrl] = useState('')
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tested, setTested] = useState<{ config: SyncServerConfig; result: ConnectionResult } | null>(null)

  const check = checkServerConfig(url, key)
  const testedOk =
    tested !== null &&
    tested.result.status === 'ok' &&
    check.ok &&
    tested.config.url === check.config.url &&
    tested.config.publicKey === check.config.publicKey

  async function test() {
    setError(null)
    setTested(null)
    if (!check.ok) {
      setError(check.error)
      return
    }
    setBusy(true)
    try {
      setTested({ config: check.config, result: await testServerConnection(check.config, fetchFn) })
    } finally {
      setBusy(false)
    }
  }

  async function save() {
    if (!testedOk || !check.ok) return
    try {
      if (await isLinked(database)) {
        setLinked(true)
        return
      }
      saveServer(check.config)
      restart()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    }
  }

  async function forget() {
    if (await isLinked(database).catch(() => true)) {
      setLinked(true)
      return
    }
    forgetSavedServer()
    restart()
  }

  return (
    <details className="mt-4 rounded-lg border border-slate-200 p-4" open={current === null}>
      <summary className="cursor-pointer text-sm font-semibold">{messages().sync.server.title}</summary>
      <div className="mt-3 space-y-3 text-sm">
        <p>
          {current === null
            ? messages().sync.server.none
            : current.source === 'built-in'
              ? messages().sync.server.builtIn(hostOf(current.config.url))
              : messages().sync.server.own(hostOf(current.config.url))}
        </p>

        {linked === undefined ? null : linked ? (
          <p className="text-slate-600">{messages().sync.server.signOutFirst}</p>
        ) : (
          <>
            <p className="text-slate-600">
              {messages().sync.server.intro}
            </p>
            <details className="rounded-lg bg-slate-50 p-3" onToggle={(event) => setGuideOpen(event.currentTarget.open)}>
              <summary className="cursor-pointer font-medium text-blue-700">{messages().serverGuide.open}</summary>
              {guideOpen && (
                <div className="mt-3">
                  <Suspense fallback={null}>
                    <ServerGuide />
                  </Suspense>
                </div>
              )}
            </details>
            <label htmlFor={`${id}-url`} className="block">
              {messages().sync.server.url}
              <input
                id={`${id}-url`}
                className={inputClass}
                value={url}
                placeholder={messages().sync.server.urlPlaceholder}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => { setUrl(event.target.value); setTested(null); setError(null) }}
              />
            </label>
            <label htmlFor={`${id}-key`} className="block">
              {messages().sync.server.key}
              <input
                id={`${id}-key`}
                className={`${inputClass} font-mono`}
                value={key}
                placeholder={messages().sync.server.keyPlaceholder}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => { setKey(event.target.value); setTested(null); setError(null) }}
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={secondaryButton} disabled={busy} onClick={() => void test()}>
                {busy ? messages().sync.server.testing : messages().sync.server.test}
              </button>
              <button type="button" className={primaryButton} disabled={!testedOk} onClick={() => void save()}>
                {messages().sync.server.save}
              </button>
              {current?.source === 'saved' && (
                <button type="button" className={secondaryButton} onClick={() => void forget()}>
                  {messages().sync.server.forget}
                </button>
              )}
            </div>
            {tested && tested.result.status === 'ok' && (
              <p role="status" className="rounded-lg bg-green-50 p-3 text-green-700">
                {messages().sync.server.works}
              </p>
            )}
            {tested && tested.result.status !== 'ok' && (
              <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-700">{tested.result.message}</p>
            )}
            {error && (
              <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-700">{error}</p>
            )}
            {current?.source === 'saved' && (
              <p className="text-xs text-slate-500">
                {messages().sync.server.forgetHelp}
              </p>
            )}
          </>
        )}
      </div>
    </details>
  )
}
