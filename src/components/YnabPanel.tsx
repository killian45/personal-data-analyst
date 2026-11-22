import { useId, useState, useSyncExternalStore } from 'react'

import { formatDayMonthYear } from '../import/screenTimeImport'
import { describeImportedDays } from '../screenTime/autoImport'
import type { AutoImportOutcome } from '../screenTime/autoImport'
import type { SyncController, SyncSnapshot } from '../sync/syncController'
import { messages } from '../i18n'
import { formatInTimezone, getDeviceTimezone } from '../time/time'
import { listBudgets } from '../ynab/ynabApi'
import type { YnabBudget } from '../ynab/ynabApi'
import { getYnabConnection, setYnabConnection, subscribeYnabConnection } from '../ynab/ynabConnection'
import { applyYnabImport, previewYnabImport, ynabImporter } from '../ynab/ynabImport'
import type { YnabPreview } from '../ynab/ynabImport'

interface YnabPanelProps {
  controller: SyncController | null
  syncConfigured: boolean
  onImported: () => void
}

const noSubscription = () => () => {}
const noSnapshot = (): SyncSnapshot | null => null
const primaryButton =
  'rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50'
const secondaryButton =
  'rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50'

function outcomeText(outcome: AutoImportOutcome): string {
  const t = messages()
  if (outcome.kind === 'imported') return t.ynab.outcomeImported(describeImportedDays(outcome.dates))
  if (outcome.kind === 'nothing-new') return t.healthData.outcomeNothingNew
  return t.healthData.outcomeFailed(outcome.message)
}

/** YNAB connection of this device and the import of its transactions (docs/YNAB_PLAN.md). */
export default function YnabPanel({ controller, syncConfigured, onImported }: YnabPanelProps) {
  const t = messages()
  const y = t.ynab
  const h = t.healthData
  const i = t.imports
  const id = useId()
  const connection = useSyncExternalStore(subscribeYnabConnection, getYnabConnection)
  const auto = useSyncExternalStore(ynabImporter.subscribe, ynabImporter.getState)
  const snapshot = useSyncExternalStore(controller ? controller.subscribe : noSubscription, controller ? controller.getSnapshot : noSnapshot)
  const [token, setToken] = useState('')
  const [budgets, setBudgets] = useState<YnabBudget[] | null>(null)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<YnabPreview | null>(null)

  const waitingForSync = syncConfigured && !controller
  const mustSyncFirst = Boolean(snapshot?.linkedUserId) && snapshot?.lastResult?.status !== 'ok'

  async function connect() {
    setError('')
    setWorking(true)
    try {
      const found = await listBudgets(token.trim())
      if (found.length === 0) setError(y.noBudget)
      else if (found.length === 1) choose(found[0])
      else setBudgets(found)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : y.connectFailed)
    } finally {
      setWorking(false)
    }
  }

  function choose(budget: YnabBudget) {
    setYnabConnection({ token: token.trim(), budgetId: budget.id, budgetName: budget.name, currency: budget.currency, serverKnowledge: null })
    setToken('')
    setBudgets(null)
  }

  async function importNow() {
    setError('')
    setResult(null)
    setWorking(true)
    try {
      const preview = await previewYnabImport()
      if (preview.toAdd.length + preview.toUpdate.length + preview.toDelete.length > 0) {
        await applyYnabImport(preview)
        onImported()
        if (snapshot?.linkedUserId) void controller?.syncNow()
      }
      setResult(preview)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : i.nothingImported)
    } finally {
      setWorking(false)
    }
  }

  const when = (ms: number) => formatInTimezone(new Date(ms).toISOString(), getDeviceTimezone(), 'dd/MM/yyyy HH:mm')

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h3 className="text-lg font-semibold">{y.title}</h3>
      <p className="mt-1 text-sm text-slate-500">
        {y.intro}
      </p>

      {!connection ? (
        budgets ? (
          <div className="mt-4 space-y-2 text-sm">
            <p>{y.chooseBudget}</p>
            <ul className="space-y-2">
              {budgets.map((budget) => (
                <li key={budget.id}>
                  <button type="button" onClick={() => choose(budget)} className={secondaryButton}>
                    {budget.name}{budget.currency ? ` (${budget.currency})` : ''}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="mt-4 space-y-2 text-sm">
            <p className="text-slate-600">
              {y.tokenHelp}
            </p>
            <label htmlFor={`${id}-token`} className="block text-xs font-medium text-slate-600">{y.token}</label>
            <input
              id={`${id}-token`}
              type="password"
              autoComplete="off"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
            />
            <button type="button" disabled={working || token.trim() === ''} onClick={() => void connect()} className={primaryButton}>
              {working ? y.connecting : y.connect}
            </button>
          </div>
        )
      ) : (
        <div className="mt-4 space-y-2 text-sm">
          <p>
            {y.connectedTo} <span className="font-medium">{connection.budgetName}</span>
            {connection.currency ? y.currency(connection.currency) : ''}.
          </p>
          <p>
            {h.automatic} <span className="font-medium">{auto.enabled ? h.on : h.off}</span>
            {auto.last && h.lastRun(when(auto.last.atMs), outcomeText(auto.last))}
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => ynabImporter.setEnabled(!auto.enabled)} className={secondaryButton}>
              {auto.enabled ? h.turnOff : h.turnOn}
            </button>
            <button type="button" onClick={() => setYnabConnection(null)} className={secondaryButton}>
              {y.disconnect}
            </button>
          </div>
          {waitingForSync ? (
            <p className="text-slate-500">{i.loadingSync}</p>
          ) : mustSyncFirst ? (
            <div className="space-y-2">
              <p className="rounded-lg bg-amber-50 p-3 text-amber-800">{y.syncFirst}</p>
              <button type="button" disabled={snapshot?.running} onClick={() => void controller?.syncNow()} className={secondaryButton}>
                {snapshot?.running ? i.syncing : i.syncNow}
              </button>
            </div>
          ) : (
            <button type="button" disabled={working} onClick={() => void importNow()} className={`block ${primaryButton}`}>
              {working ? i.importing : h.importNow}
            </button>
          )}
        </div>
      )}

      {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {result && (
        <div role="status" className="mt-4 rounded-lg bg-green-50 p-3 text-sm text-green-700">
          {y.result(result.toAdd.length, result.toUpdate.length, result.toDelete.length, result.unchanged, result.deletedInPda, result.notImported.length)}
          {result.toAdd.length > 0 && y.oldest(formatDayMonthYear([...result.toAdd].map((s) => String(s.metadata?.localDate)).sort()[0]))}
        </div>
      )}
    </section>
  )
}
