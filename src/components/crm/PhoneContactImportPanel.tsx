import { useId, useState, useSyncExternalStore } from 'react'

import { foldForSearch } from '../../crm/contactForm'
import { applyPhoneContactImport, candidateSummary, previewPhoneContactImport } from '../../crm/phoneContactImport'
import type { ImportIssueItem, PhoneContactPlan } from '../../crm/phoneContactImport'
import { checkContactsPermission, requestContactsPermission } from '../../crm/phoneContactsPlugin'
import { openAppSettings } from '../../screenTime/usageStatsPlugin'
import type { SyncController, SyncSnapshot } from '../../sync/syncController'
import { messages } from '../../i18n'

const primaryButton =
  'rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50'
const secondaryButton =
  'rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50'

const noSubscription = () => () => {}
const noSnapshot = (): SyncSnapshot | null => null

interface PhoneContactImportPanelProps {
  /** Sync controller once loaded (null: sync off or still loading). */
  controller: SyncController | null
  /** Sync is configured for this build (then wait for the controller). */
  syncConfigured: boolean
  onImported?: () => void
}

function IssueGroup({ title, items }: { title: string; items: ImportIssueItem[] }) {
  if (items.length === 0) return null
  return (
    <details className="rounded-lg border border-slate-200 p-3 text-sm">
      <summary className="cursor-pointer font-medium">{messages().crm.phoneImport.groupTitle(title, items.length)}</summary>
      <ul className="mt-2 space-y-1">
        {items.map((item, index) => (
          <li key={`${item.name}-${index}`} className="break-words text-xs text-slate-600">
            <span className="font-medium text-slate-700">{item.name}</span>: {item.reason}
          </li>
        ))}
      </ul>
    </details>
  )
}

/**
 * Import of the phone's contacts into the CRM (Android app only, CRM
 * step 3). Reads only; a preview lets the user choose who to import
 * (nothing chosen at first). Sync first: on a linked device, contacts
 * imported earlier (and kept in the cloud) must arrive before importing,
 * or they would be imported twice.
 */
export default function PhoneContactImportPanel({ controller, syncConfigured, onImported }: PhoneContactImportPanelProps) {
  const t = messages()
  const p = t.crm.phoneImport
  const id = useId()
  const snapshot = useSyncExternalStore(
    controller ? controller.subscribe : noSubscription,
    controller ? controller.getSnapshot : noSnapshot,
  )
  const waitingForSync = syncConfigured && !controller
  const mustSyncFirst = Boolean(snapshot?.linkedUserId) && snapshot?.lastResult?.status !== 'ok'
  const [plan, setPlan] = useState<PhoneContactPlan | null>(null)
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [working, setWorking] = useState(false)
  const [denied, setDenied] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState('')

  async function read() {
    setError('')
    setResult('')
    setDenied(false)
    setWorking(true)
    try {
      let permission = await checkContactsPermission()
      if (permission !== 'granted') permission = await requestContactsPermission()
      if (permission !== 'granted') {
        setDenied(true)
        return
      }
      setPlan(await previewPhoneContactImport())
      setChosen(new Set())
      setQuery('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : p.readFailed)
    } finally {
      setWorking(false)
    }
  }

  async function importChosen() {
    if (!plan) return
    setError('')
    setWorking(true)
    try {
      const count = await applyPhoneContactImport(plan.candidates.filter((candidate) => chosen.has(candidate.key)))
      setResult(p.imported(count))
      setPlan(null)
      onImported?.()
      // Send the new contacts to the other devices.
      if (snapshot?.linkedUserId && count > 0) void controller?.syncNow()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : p.nothingImported)
    } finally {
      setWorking(false)
    }
  }

  const words = foldForSearch(query).split(/\s+/).filter(Boolean)
  const shown = plan
    ? plan.candidates.filter((candidate) => {
        const haystack = foldForSearch(`${candidate.input.name}\n${candidate.input.address ?? ''}`)
        return words.every((word) => haystack.includes(word))
      })
    : []

  function toggle(key: string) {
    setChosen((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h3 className="text-lg font-semibold">{p.title}</h3>
      <p className="mt-1 text-sm text-slate-500">
        {p.intro}
      </p>

      {!plan && (waitingForSync ? (
        <p className="mt-4 text-sm text-slate-500">{p.loadingSync}</p>
      ) : mustSyncFirst ? (
        <div className="mt-4 space-y-2 text-sm">
          <p className="rounded-lg bg-amber-50 p-3 text-amber-800">
            {p.syncFirst}
            {snapshot?.lastResult && snapshot.lastResult.status !== 'ok' && p.lastSyncUnfinished}
          </p>
          <button type="button" disabled={snapshot?.running} onClick={() => void controller?.syncNow()} className={secondaryButton}>
            {snapshot?.running ? p.syncing : p.syncNow}
          </button>
        </div>
      ) : (
        <button type="button" disabled={working} onClick={() => void read()} className={`mt-4 ${primaryButton}`}>
          {working ? p.reading : p.read}
        </button>
      ))}

      {denied && (
        <div className="mt-4 space-y-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          <p>
            {p.denied}
          </p>
          <button type="button" onClick={() => void openAppSettings()} className={secondaryButton}>{p.openSettings}</button>
        </div>
      )}

      {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {result && <p role="status" className="mt-4 rounded-lg bg-green-50 p-3 text-sm text-green-700">{result}</p>}

      {plan && (
        <div className="mt-4 space-y-4">
          <p className="text-sm">
            {p.found(plan.found, plan.candidates.length)}
          </p>

          {plan.candidates.length > 0 && (
            <>
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-0 flex-1">
                  <label htmlFor={`${id}-search`} className="mb-1 block text-xs font-medium text-slate-600">{p.search}</label>
                  <input
                    id={`${id}-search`}
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setChosen((current) => new Set([...current, ...shown.map((candidate) => candidate.key)]))}
                  className={secondaryButton}
                >
                  {p.selectAllShown}
                </button>
                <button type="button" onClick={() => setChosen(new Set())} className={secondaryButton}>{p.selectNone}</button>
              </div>

              <ul aria-label={p.importable} className="max-h-[50vh] overflow-y-auto rounded-lg border border-slate-200">
                {shown.map((candidate) => {
                  const summary = candidateSummary(candidate)
                  return (
                    <li key={candidate.key} className="border-b border-slate-200 last:border-b-0">
                      <label className="flex cursor-pointer items-start gap-3 p-3 text-sm hover:bg-slate-50">
                        <input type="checkbox" checked={chosen.has(candidate.key)} onChange={() => toggle(candidate.key)} className="mt-1" />
                        <span className="min-w-0">
                          <span className="block break-words font-medium">{candidate.input.name}</span>
                          {summary && <span className="block truncate text-xs text-slate-500">{summary}</span>}
                          {candidate.sameNameAsExisting && (
                            <span className="block text-xs text-amber-700">{p.sameName}</span>
                          )}
                          {candidate.notes.map((note) => (
                            <span key={note} className="block text-xs text-amber-700">{note}</span>
                          ))}
                        </span>
                      </label>
                    </li>
                  )
                })}
                {shown.length === 0 && <li className="p-3 text-sm text-slate-500">{p.noMatch}</li>}
              </ul>
            </>
          )}

          <IssueGroup title={p.alreadyImported} items={plan.alreadyImported} />
          <IssueGroup title={p.changedOnPhone} items={plan.changedOnPhone} />
          <IssueGroup title={p.deletedInPda} items={plan.deletedInPda} />
          <IssueGroup title={p.notImportable} items={plan.notImportable} />

          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={working || chosen.size === 0} onClick={() => void importChosen()} className={primaryButton}>
              {working ? p.importing : p.importCount(chosen.size)}
            </button>
            <button type="button" disabled={working} onClick={() => setPlan(null)} className={secondaryButton}>{t.common.cancel}</button>
          </div>
        </div>
      )}
    </section>
  )
}
