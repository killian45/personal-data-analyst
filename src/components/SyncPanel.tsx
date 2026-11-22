import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'

import { db as appDatabase, type PersonalDataDatabase } from '../database/db'
import { saveFile } from '../files/saveFile'
import { messages } from '../i18n'
import { resolveDisplayZone, type DisplayTimezone } from '../settings/displayTimezone'
import { LOCAL_MAILBOX_URL, isPlausibleEmail, type SyncBackend, type SyncUser } from '../sync/backendTypes'
import type { CreatedKeys } from '../sync/crypto'
import { describeSyncResult, formatSyncTime, type Tone } from '../sync/describe'
import {
  changeSyncPassphrase,
  completeFirstDeviceSetup,
  prepareFirstDeviceKeys,
  removeLocalDataIfSafe,
  startOver,
  unlinkDevice,
  unlockThisDevice,
} from '../sync/device'
import { checkPassphrase, MIN_PASSPHRASE_LENGTH } from '../sync/passphrase'
import type { SyncController } from '../sync/syncController'
import { getDeviceTimezone } from '../time/time'
import { SyncIssuesList } from './SyncIssuesList'
import { SyncServerSettings } from './SyncServerSettings'

interface SyncPanelProps {
  backend: SyncBackend | null
  /** Sync is configured but still loading (backend not ready yet). */
  loading?: boolean
  controller: SyncController | null
  displayTimezone: DisplayTimezone
  /** Called when sync changed local data, so other views reload. */
  onDataChanged: () => void
  database?: PersonalDataDatabase
  /** Tests only: a lower PBKDF2 iteration count to keep tests fast. */
  keyIterations?: number
}

const inputClass = 'mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm'
const primaryButton =
  'rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50'
const secondaryButton =
  'rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50'

const toneClass: Record<Tone, string> = {
  ok: 'bg-green-50 text-green-700',
  warning: 'bg-amber-50 text-amber-800',
  error: 'bg-red-50 text-red-700',
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

type SecretMethod = 'passphrase' | 'recoveryKey'

/** Readable message for a passphrase / recovery key that did not work. */
function secretProblem(
  result:
    | { status: 'wrong-secret' }
    | { status: 'invalid-recovery-key'; reason: 'length' | 'character' | 'checksum' }
    | { status: 'invalid-envelope'; reason: string }
    | { status: 'no-key' },
  method: SecretMethod,
): string {
  switch (result.status) {
    case 'wrong-secret':
      return method === 'passphrase' ? messages().sync.wrongPassphrase : messages().sync.wrongRecoveryKey
    case 'invalid-recovery-key':
      return result.reason === 'length'
        ? messages().sync.keyLength
        : result.reason === 'character'
          ? messages().sync.keyCharacter
          : messages().sync.keyChecksum
    case 'invalid-envelope':
      return messages().sync.keyDamaged(result.reason)
    case 'no-key':
      return messages().sync.noKey
  }
}

function SecretChoice({
  method,
  onMethod,
  secret,
  onSecret,
  passphraseLabel,
}: {
  method: SecretMethod
  onMethod: (method: SecretMethod) => void
  secret: string
  onSecret: (secret: string) => void
  passphraseLabel?: string
}) {
  return (
    <>
      <fieldset className="flex gap-4">
        <label className="flex items-center gap-1">
          <input type="radio" checked={method === 'passphrase'} onChange={() => onMethod('passphrase')} />
          {messages().sync.usePassphrase}
        </label>
        <label className="flex items-center gap-1">
          <input type="radio" checked={method === 'recoveryKey'} onChange={() => onMethod('recoveryKey')} />
          {messages().sync.useRecoveryKey}
        </label>
      </fieldset>
      <label className="block">
        {method === 'passphrase' ? (passphraseLabel ?? messages().sync.passphrase) : messages().sync.recoveryKey}
        <input
          type={method === 'passphrase' ? 'password' : 'text'}
          className={inputClass}
          value={secret}
          onChange={(event) => onSecret(event.target.value)}
          autoComplete={method === 'passphrase' ? 'current-password' : 'off'}
        />
      </label>
    </>
  )
}

function Section({ children }: { children: ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h3 className="text-lg font-semibold">{messages().sync.title}</h3>
      {children}
    </section>
  )
}

function ErrorText({ error }: { error: string | null }) {
  return error ? (
    <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">
      {error}
    </p>
  ) : null
}

/**
 * Sync settings (docs/SYNC_DESIGN.md §7): sign-in with an email code,
 * first-device setup (passphrase + recovery key), unlocking other devices,
 * status and "Sync now", conflicts, sign-out and deleting cloud data.
 */
export function SyncPanel(props: SyncPanelProps) {
  if (!props.backend || !props.controller) {
    return props.loading ? (
      <Section>
        <p className="mt-1 text-sm text-slate-500">{messages().sync.loading}</p>
      </Section>
    ) : (
      <UnconfiguredSyncPanel database={props.database ?? appDatabase} />
    )
  }
  return <ConfiguredSyncPanel {...props} backend={props.backend} controller={props.controller} />
}

/** No server: sync is off; the person can connect their own server. */
function UnconfiguredSyncPanel({ database }: { database: PersonalDataDatabase }) {
  return (
    <Section>
      <p className="mt-1 text-sm text-slate-500">{messages().sync.off}</p>
      <SyncServerSettings database={database} />
    </Section>
  )
}

function ConfiguredSyncPanel({
  backend,
  controller,
  displayTimezone,
  onDataChanged,
  database = appDatabase,
  keyIterations,
}: SyncPanelProps & { backend: SyncBackend; controller: SyncController }) {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const [user, setUser] = useState<SyncUser | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [suggestNewPassphrase, setSuggestNewPassphrase] = useState(false)
  const zone = resolveDisplayZone(displayTimezone, getDeviceTimezone())

  useEffect(() => {
    void controller.refresh()
    backend.auth.getUser().then(setUser, (caught) => {
      setUser(null)
      setError(messageOf(caught))
    })
  }, [backend, controller])

  async function signOut() {
    setError(null)
    try {
      await unlinkDevice(database)
      await backend.auth.signOut()
      await controller.refresh()
      setUser(null)
    } catch (caught) {
      setError(messageOf(caught))
    }
  }

  async function afterDataRemoved() {
    setUser(null)
    await controller.refresh()
    onDataChanged()
    setNotice(messages().sync.signedOutRemoved)
  }

  let content: ReactNode
  if (user === undefined) {
    content = <p className="mt-2 text-sm text-slate-500">{messages().sync.checkingSignIn}</p>
  } else if (user === null) {
    content = <SignInForm backend={backend} onSignedIn={setUser} />
  } else if (snapshot.linkedUserId && snapshot.linkedUserId !== user.id) {
    content = (
      <div className="mt-2 space-y-3 text-sm">
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-700">
          {messages().sync.otherAccount(user.email)}
        </p>
        <button type="button" className={secondaryButton} onClick={() => void signOut()}>
          {messages().sync.signOutUnlink}
        </button>
      </div>
    )
  } else if (snapshot.linkedUserId === user.id) {
    content = (
      <LinkedView
        user={user}
        backend={backend}
        controller={controller}
        database={database}
        zone={zone}
        onDataChanged={onDataChanged}
        onSignOut={signOut}
        onNotice={setNotice}
        onDataRemoved={afterDataRemoved}
        openChangePassphrase={suggestNewPassphrase}
        keyIterations={keyIterations}
      />
    )
  } else {
    content = (
      <LinkSetup
        user={user}
        backend={backend}
        database={database}
        keyIterations={keyIterations}
        onLinked={async (method) => {
          if (method === 'recoveryKey') {
            setSuggestNewPassphrase(true)
            setNotice(
              messages().sync.unlockedWithKey,
            )
          }
          await controller.refresh()
          await controller.syncNow()
        }}
        onNotice={setNotice}
        onSignOut={signOut}
      />
    )
  }

  return (
    <Section>
      <p className="mt-1 text-sm text-slate-500">
        {messages().sync.intro}
        {backend.isLocalTestServer && messages().sync.localServer}
      </p>
      {notice && (
        <p role="status" className="mt-3 rounded-lg bg-green-50 p-3 text-sm text-green-700">
          {notice}
        </p>
      )}
      {content}
      <ErrorText error={error} />
      {user !== undefined && <SyncServerSettings database={database} linkKey={`${snapshot.linkedUserId}:${user?.id}`} />}
    </Section>
  )
}

function SignInForm({ backend, onSignedIn }: { backend: SyncBackend; onSignedIn: (user: SyncUser) => void }) {
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function sendCode() {
    if (!isPlausibleEmail(email)) {
      setError(messages().sync.invalidEmail)
      return
    }
    setBusy(true)
    setError(null)
    try {
      await backend.auth.sendCode(email)
      setCodeSent(true)
    } catch (caught) {
      setError(messageOf(caught))
    } finally {
      setBusy(false)
    }
  }

  async function verify() {
    if (!/^\d{6}$/.test(code.trim())) {
      setError(messages().sync.codeDigits)
      return
    }
    setBusy(true)
    setError(null)
    try {
      onSignedIn(await backend.auth.verifyCode(email, code))
    } catch (caught) {
      setError(messageOf(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-4 max-w-md space-y-3 text-sm">
      <label className="block">
        {messages().sync.email}
        <input
          type="email"
          className={inputClass}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          disabled={codeSent}
          autoComplete="email"
        />
      </label>

      {!codeSent ? (
        <button type="button" className={primaryButton} disabled={busy} onClick={() => void sendCode()}>
          {busy ? messages().sync.sending : messages().sync.sendCode}
        </button>
      ) : (
        <>
          <p className="text-slate-600">
            {messages().sync.codeSent(email.trim())}
            {backend.isLocalTestServer && (
              <>
                {' '}
                {messages().sync.localMailbox}{' '}
                <a className="text-blue-700 underline" href={LOCAL_MAILBOX_URL} target="_blank" rel="noreferrer">
                  {LOCAL_MAILBOX_URL}
                </a>
                .
              </>
            )}
          </p>
          <label className="block">
            {messages().sync.code}
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              className={inputClass}
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={primaryButton} disabled={busy} onClick={() => void verify()}>
              {busy ? messages().sync.checking : messages().sync.signIn}
            </button>
            <button
              type="button"
              className={secondaryButton}
              disabled={busy}
              onClick={() => {
                setCodeSent(false)
                setCode('')
              }}
            >
              {messages().sync.anotherEmail}
            </button>
          </div>
        </>
      )}
      <ErrorText error={error} />
    </div>
  )
}

function LinkSetup({
  user,
  backend,
  database,
  keyIterations,
  onLinked,
  onNotice,
  onSignOut,
}: {
  user: SyncUser
  backend: SyncBackend
  database: PersonalDataDatabase
  keyIterations?: number
  onLinked: (method: SecretMethod | 'new') => Promise<void>
  onNotice: (message: string) => void
  onSignOut: () => Promise<void>
}) {
  const [hasKey, setHasKey] = useState<boolean | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    backend.server.getKeyEnvelope().then(
      (envelope) => {
        if (!cancelled) setHasKey(envelope !== null)
      },
      (caught) => {
        if (!cancelled) setError(messageOf(caught))
      },
    )
    return () => {
      cancelled = true
    }
  }, [backend, attempt])

  const check = useCallback(() => {
    setError(null)
    setHasKey(undefined)
    setAttempt((n) => n + 1)
  }, [])

  return (
    <div className="mt-4 space-y-4 text-sm">
      <p>{messages().sync.signedInAs(user.email)}</p>
      {error ? (
        <>
          <ErrorText error={error} />
          <button type="button" className={secondaryButton} onClick={check}>
            {messages().sync.tryAgain}
          </button>
        </>
      ) : hasKey === undefined ? (
        <p className="text-slate-500">{messages().sync.checkingAccount}</p>
      ) : hasKey ? (
        <UnlockForm
          user={user}
          backend={backend}
          database={database}
          onLinked={onLinked}
          onNoKey={check}
          onStartedOver={(count) => {
            onNotice(
              messages().sync.startedOver(count),
            )
            check()
          }}
        />
      ) : (
        <FirstDeviceSetup
          user={user}
          backend={backend}
          database={database}
          keyIterations={keyIterations}
          onLinked={onLinked}
          onKeyExists={check}
        />
      )}
      <button type="button" className={secondaryButton} onClick={() => void onSignOut()}>
        {messages().sync.signOut}
      </button>
    </div>
  )
}

function FirstDeviceSetup({
  user,
  backend,
  database,
  keyIterations,
  onLinked,
  onKeyExists,
}: {
  user: SyncUser
  backend: SyncBackend
  database: PersonalDataDatabase
  keyIterations?: number
  onLinked: (method: 'new') => Promise<void>
  onKeyExists: () => void
}) {
  const [passphrase, setPassphrase] = useState('')
  const [repeat, setRepeat] = useState('')
  const [keys, setKeys] = useState<CreatedKeys | null>(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function createKey() {
    const check = checkPassphrase(passphrase)
    if (check.status !== 'ok') {
      setError(messages().sync.passphraseTooShort(MIN_PASSPHRASE_LENGTH, check.length))
      return
    }
    if (passphrase !== repeat) {
      setError(messages().sync.passphrasesDiffer)
      return
    }
    setBusy(true)
    setError(null)
    try {
      setKeys(await prepareFirstDeviceKeys(passphrase, keyIterations ? { iterations: keyIterations } : undefined))
    } catch (caught) {
      setError(messageOf(caught))
    } finally {
      setBusy(false)
    }
  }

  async function start() {
    if (!keys) return
    setBusy(true)
    setError(null)
    try {
      await completeFirstDeviceSetup(database, backend.server, user.id, keys)
      setPassphrase('')
      setRepeat('')
      await onLinked('new')
    } catch (caught) {
      const message = messageOf(caught)
      if (/already exists|duplicate/i.test(message)) {
        setError(messages().sync.otherDeviceFirst)
        onKeyExists()
      } else {
        setError(message)
      }
    } finally {
      setBusy(false)
    }
  }

  if (keys) {
    return (
      <div className="space-y-3">
        <h4 className="font-semibold">{messages().sync.recoveryTitle}</h4>
        <p>
          {messages().sync.recoveryIntro}
        </p>
        <p data-testid="recovery-key" className="rounded-lg bg-slate-100 p-3 font-mono text-lg tracking-wider">
          {keys.recoveryKey}
        </p>
        <button
          type="button"
          className={secondaryButton}
          onClick={() =>
            void saveFile(
              messages().sync.recoveryFile(keys.recoveryKey, user.email),
              'text/plain',
              'pda-recovery-key.txt',
            ).catch((caught: unknown) => setError(messageOf(caught)))
          }
        >
          {messages().sync.downloadText}
        </button>
        <label className="flex items-start gap-2">
          <input type="checkbox" checked={saved} onChange={(event) => setSaved(event.target.checked)} />
          <span>{messages().sync.savedKey}</span>
        </label>
        <button type="button" className={primaryButton} disabled={!saved || busy} onClick={() => void start()}>
          {busy ? messages().sync.starting : messages().sync.startSyncing}
        </button>
        <ErrorText error={error} />
      </div>
    )
  }

  return (
    <div className="max-w-md space-y-3">
      <h4 className="font-semibold">{messages().sync.setupTitle}</h4>
      <p>
        {messages().sync.setupIntro}
      </p>
      <label className="block">
        {messages().sync.passphraseMin(MIN_PASSPHRASE_LENGTH)}
        <input
          type="password"
          className={inputClass}
          value={passphrase}
          onChange={(event) => setPassphrase(event.target.value)}
          autoComplete="new-password"
        />
      </label>
      <label className="block">
        {messages().sync.repeatPassphrase}
        <input
          type="password"
          className={inputClass}
          value={repeat}
          onChange={(event) => setRepeat(event.target.value)}
          autoComplete="new-password"
        />
      </label>
      <button type="button" className={primaryButton} disabled={busy} onClick={() => void createKey()}>
        {busy ? messages().sync.creatingKey : messages().sync.createKey}
      </button>
      <ErrorText error={error} />
    </div>
  )
}

function UnlockForm({
  user,
  backend,
  database,
  onLinked,
  onNoKey,
  onStartedOver,
}: {
  user: SyncUser
  backend: SyncBackend
  database: PersonalDataDatabase
  onLinked: (method: SecretMethod) => Promise<void>
  onNoKey: () => void
  onStartedOver: (deletedRecords: number) => void
}) {
  const [method, setMethod] = useState<SecretMethod>('passphrase')
  const [secret, setSecret] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [startOverText, setStartOverText] = useState('')

  async function unlock() {
    setBusy(true)
    setError(null)
    try {
      const result = await unlockThisDevice(
        database,
        backend.server,
        user.id,
        method === 'passphrase' ? { kind: 'passphrase', passphrase: secret } : { kind: 'recoveryKey', recoveryKey: secret },
      )
      if (result.status === 'ok') {
        setSecret('')
        await onLinked(method)
      } else if (result.status === 'no-key') {
        onNoKey()
      } else {
        setError(secretProblem(result, method))
      }
    } catch (caught) {
      setError(messageOf(caught))
    } finally {
      setBusy(false)
    }
  }

  async function confirmStartOver() {
    setBusy(true)
    setError(null)
    try {
      onStartedOver(await startOver(database, backend.server))
    } catch (caught) {
      setError(messageOf(caught))
      setBusy(false)
    }
  }

  return (
    <div className="max-w-md space-y-3">
      <h4 className="font-semibold">{messages().sync.unlockTitle}</h4>
      <p>
        {messages().sync.unlockIntro}
      </p>
      <SecretChoice method={method} onMethod={setMethod} secret={secret} onSecret={setSecret} />
      <button type="button" className={primaryButton} disabled={busy || secret === ''} onClick={() => void unlock()}>
        {busy ? messages().sync.checkingSlow : messages().sync.unlock}
      </button>
      <ErrorText error={error} />

      <details className="rounded-lg border border-slate-200 p-4">
        <summary className="cursor-pointer font-medium">{messages().sync.lostBoth}</summary>
        <p className="mt-2">
          {messages().sync.lostBothText}
        </p>
        <label className="mt-2 block">
          {messages().common.typeToConfirm(messages().confirmWords.startOver)}
          <input className={inputClass} value={startOverText} onChange={(event) => setStartOverText(event.target.value)} />
        </label>
        <button
          type="button"
          className="mt-2 rounded-lg bg-red-600 px-4 py-2 font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={startOverText !== messages().confirmWords.startOver || busy}
          onClick={() => void confirmStartOver()}
        >
          {messages().sync.startOver}
        </button>
      </details>
    </div>
  )
}

function ChangePassphraseForm({
  user,
  backend,
  keyIterations,
}: {
  user: SyncUser
  backend: SyncBackend
  keyIterations?: number
}) {
  const [method, setMethod] = useState<SecretMethod>('passphrase')
  const [secret, setSecret] = useState('')
  const [next, setNext] = useState('')
  const [repeat, setRepeat] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  async function change() {
    setError(null)
    setDone(null)
    const check = checkPassphrase(next)
    if (check.status !== 'ok') {
      setError(messages().sync.newPassphraseTooShort(MIN_PASSPHRASE_LENGTH, check.length))
      return
    }
    if (next !== repeat) {
      setError(messages().sync.newPassphrasesDiffer)
      return
    }
    setBusy(true)
    try {
      const result = await changeSyncPassphrase(
        backend.server,
        user.id,
        method === 'passphrase' ? { kind: 'passphrase', passphrase: secret } : { kind: 'recoveryKey', recoveryKey: secret },
        next,
        keyIterations ? { iterations: keyIterations } : undefined,
      )
      if (result.status === 'ok') {
        setSecret('')
        setNext('')
        setRepeat('')
        setDone(
          messages().sync.passphraseChanged,
        )
      } else {
        setError(secretProblem(result, method))
      }
    } catch (caught) {
      setError(messageOf(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-2 max-w-md space-y-3">
      <p>{messages().sync.confirmCurrent}</p>
      <SecretChoice
        method={method}
        onMethod={setMethod}
        secret={secret}
        onSecret={setSecret}
        passphraseLabel={messages().sync.currentPassphrase}
      />
      <label className="block">
        {messages().sync.newPassphraseMin(MIN_PASSPHRASE_LENGTH)}
        <input
          type="password"
          className={inputClass}
          value={next}
          onChange={(event) => setNext(event.target.value)}
          autoComplete="new-password"
        />
      </label>
      <label className="block">
        {messages().sync.repeatNew}
        <input
          type="password"
          className={inputClass}
          value={repeat}
          onChange={(event) => setRepeat(event.target.value)}
          autoComplete="new-password"
        />
      </label>
      <button type="button" className={primaryButton} disabled={busy || secret === ''} onClick={() => void change()}>
        {busy ? messages().sync.changing : messages().sync.changePassphrase}
      </button>
      {done && (
        <p role="status" className="rounded-lg bg-green-50 p-3 text-green-700">
          {done}
        </p>
      )}
      <ErrorText error={error} />
    </div>
  )
}

function LinkedView({
  user,
  backend,
  controller,
  database,
  zone,
  onDataChanged,
  onSignOut,
  onNotice,
  onDataRemoved,
  openChangePassphrase,
  keyIterations,
}: {
  user: SyncUser
  backend: SyncBackend
  controller: SyncController
  database: PersonalDataDatabase
  zone: string
  onDataChanged: () => void
  onSignOut: () => Promise<void>
  onNotice: (message: string) => void
  onDataRemoved: () => Promise<void>
  openChangePassphrase: boolean
  keyIterations?: number
}) {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const [confirmText, setConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [removeText, setRemoveText] = useState('')
  const [removing, setRemoving] = useState(false)
  const [removeProblems, setRemoveProblems] = useState<string[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const result = snapshot.lastResult ? describeSyncResult(snapshot.lastResult) : null

  async function deleteCloudData() {
    setDeleting(true)
    setError(null)
    try {
      const count = await backend.server.deleteCloudData()
      await unlinkDevice(database)
      onNotice(
        messages().sync.cloudDeleted(count),
      )
      // Switches this panel back to "set up sync".
      await controller.refresh()
    } catch (caught) {
      setError(messageOf(caught))
      setDeleting(false)
      setConfirmText('')
    }
  }

  async function signOutAndRemove() {
    setRemoving(true)
    setRemoveProblems(null)
    setError(null)
    try {
      // A final sync first, so the server has the latest version of everything.
      const result = await controller.syncNow()
      if (!result || result.status !== 'ok') {
        setRemoveProblems([
          result ? describeSyncResult(result).text : messages().sync.alreadyRunning,
        ])
        return
      }
      const removal = await removeLocalDataIfSafe(database)
      if (removal.status === 'blocked') {
        setRemoveProblems(removal.reasons)
        return
      }
      await backend.auth.signOut()
      await onDataRemoved()
    } catch (caught) {
      setError(messageOf(caught))
    } finally {
      setRemoving(false)
      setRemoveText('')
    }
  }

  return (
    <div className="mt-4 space-y-3 text-sm">
      <p>
        {messages().sync.lastSync(user.email, snapshot.lastFinishedAt ? formatSyncTime(snapshot.lastFinishedAt, zone) : messages().sync.notYet)}
      </p>
      <p>
        {snapshot.pending === 0
          ? messages().sync.noPending
          : messages().sync.pending(snapshot.pending)}
      </p>

      {result && (
        <p role="status" className={`rounded-lg p-3 ${toneClass[result.tone]}`}>
          {result.text}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={primaryButton}
          disabled={snapshot.running}
          onClick={() => void controller.syncNow()}
        >
          {snapshot.running ? messages().sync.syncing : messages().sync.syncNow}
        </button>
      </div>

      <SyncIssuesList
        database={database}
        zone={zone}
        reloadKey={`${snapshot.lastFinishedAt ?? ''}:${snapshot.issues}`}
        onResolved={() => {
          onDataChanged()
          void controller.refresh().then(() => controller.syncNow())
        }}
      />

      <details className="mt-6 rounded-lg border border-slate-200 p-4" open={openChangePassphrase || undefined}>
        <summary className="cursor-pointer font-medium">{messages().sync.changePassphrase}</summary>
        <ChangePassphraseForm user={user} backend={backend} keyIterations={keyIterations} />
      </details>

      <details className="rounded-lg border border-slate-200 p-4">
        <summary className="cursor-pointer font-medium">{messages().sync.signOutTitle}</summary>
        <p className="mt-2">{messages().sync.signOutText}</p>
        <button type="button" className={`mt-2 ${secondaryButton}`} onClick={() => void onSignOut()}>
          {messages().sync.signOutKeep}
        </button>

        <div className="mt-4 border-t border-slate-200 pt-4">
          <p className="font-medium">{messages().sync.removeTitle}</p>
          <p className="mt-1">
            {messages().sync.removeText}
          </p>
          <label className="mt-2 block">
            {messages().common.typeToConfirm(messages().confirmWords.remove)}
            <input className={inputClass} value={removeText} onChange={(event) => setRemoveText(event.target.value)} />
          </label>
          <button
            type="button"
            className="mt-2 rounded-lg bg-red-600 px-4 py-2 font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={removeText !== messages().confirmWords.remove || removing}
            onClick={() => void signOutAndRemove()}
          >
            {removing ? messages().sync.removing : messages().sync.remove}
          </button>
          {removeProblems && (
            <div role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-red-700">
              <p>{messages().sync.nothingRemoved}</p>
              <ul className="mt-1 list-disc pl-5">
                {removeProblems.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </details>

      <details className="rounded-lg border border-red-200 p-4">
        <summary className="cursor-pointer font-medium text-red-700">{messages().sync.deleteTitle}</summary>
        <p className="mt-2">
          {messages().sync.deleteText}
        </p>
        <label className="mt-2 block">
          {messages().common.typeToConfirm(messages().confirmWords.delete)}
          <input className={inputClass} value={confirmText} onChange={(event) => setConfirmText(event.target.value)} />
        </label>
        <button
          type="button"
          className="mt-2 rounded-lg bg-red-600 px-4 py-2 font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={confirmText !== messages().confirmWords.delete || deleting}
          onClick={() => void deleteCloudData()}
        >
          {deleting ? messages().sync.deleting : messages().sync.deleteTitle}
        </button>
      </details>
      <ErrorText error={error} />
    </div>
  )
}
