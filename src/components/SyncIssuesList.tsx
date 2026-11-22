import { useCallback, useEffect, useState } from 'react'

import type { PersonalDataDatabase } from '../database/db'
import type { SyncConflictRecord } from '../database/types'
import { differingFields, issueTitle, type FieldDifference } from '../sync/describe'
import { resolveConflict, type ConflictChoice } from '../sync/engine'
import { messages } from '../i18n'

interface IssueView {
  issue: SyncConflictRecord
  title: string
  hasLocal: boolean
  differences: FieldDifference[]
}

interface SyncIssuesListProps {
  database: PersonalDataDatabase
  /** Timezone used to show times. */
  zone: string
  /** Changes whenever the list must be reloaded (e.g. after a sync). */
  reloadKey: string
  onResolved: () => void
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

/**
 * Sync conflicts and problems waiting for the user (SYNC_DESIGN.md §6).
 * Both versions are shown side by side; nothing is chosen automatically.
 */
export function SyncIssuesList({ database, zone, reloadKey, onResolved }: SyncIssuesListProps) {
  const [items, setItems] = useState<IssueView[] | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (): Promise<IssueView[]> => {
    const issues = await database.syncConflicts.orderBy('detectedAt').toArray()
    const views: IssueView[] = []
    for (const issue of issues) {
      const local = asRecord(await database.table(issue.collection).get(issue.recordId))
      const remote = asRecord(issue.remoteRecord)
      const shown = local ?? remote
      const habitId = shown?.habitId
      const habit = typeof habitId === 'string' ? await database.habits.get(habitId) : undefined
      const contactId = shown?.contactId
      const contact = typeof contactId === 'string' ? await database.contacts.get(contactId) : undefined
      views.push({
        issue,
        title: issueTitle(issue.collection, shown, issue.recordId, zone, habit?.name, contact?.name),
        hasLocal: local !== undefined,
        differences: issue.kind === 'conflict' ? differingFields(local, remote, zone) : [],
      })
    }
    return views
  }, [database, zone])

  useEffect(() => {
    let cancelled = false
    void load().then((views) => {
      if (!cancelled) setItems(views)
    })
    return () => {
      cancelled = true
    }
  }, [load, reloadKey])

  async function choose(id: string, choice: ConflictChoice) {
    setBusyId(id)
    setError(null)
    try {
      await resolveConflict(database, id, choice)
      setItems(await load())
      onResolved()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusyId(null)
    }
  }

  if (!items || items.length === 0) return null

  return (
    <div className="mt-6 space-y-4">
      <h4 className="font-semibold">{messages().sync.issues.waiting(items.length)}</h4>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}

      <ul className="space-y-4">
        {items.map(({ issue, title, hasLocal, differences }) => (
          <li key={issue.id} className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm">
            <p className="font-medium">{title}</p>

            {issue.kind === 'conflict' ? (
              <>
                <p className="mt-1 text-slate-600">
                  {messages().sync.issues.conflict}
                </p>
                <table className="mt-3 w-full text-left">
                  <thead>
                    <tr className="text-slate-500">
                      <th className="py-1 pr-3 font-medium">{messages().sync.issues.field}</th>
                      <th className="py-1 pr-3 font-medium">{messages().sync.issues.thisDevice}</th>
                      <th className="py-1 font-medium">{messages().sync.issues.otherDevice}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {differences.map((difference) => (
                      <tr key={difference.field} className="border-t border-amber-200 align-top">
                        <td className="py-1 pr-3">{difference.label}</td>
                        <td className="py-1 pr-3">{difference.thisDevice}</td>
                        <td className="py-1">{difference.otherDevice}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busyId !== null}
                    onClick={() => void choose(issue.id, 'keep-this-device')}
                    className="rounded-lg bg-blue-600 px-3 py-1.5 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {messages().sync.issues.keepThis}
                  </button>
                  <button
                    type="button"
                    disabled={busyId !== null}
                    onClick={() => void choose(issue.id, 'keep-other')}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-medium hover:bg-slate-50 disabled:opacity-50"
                  >
                    {messages().sync.issues.keepOther}
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="mt-1 text-slate-600">
                  {messages().sync.issues.unusable(issue.reason)}
                </p>
                {hasLocal ? (
                  <button
                    type="button"
                    disabled={busyId !== null}
                    onClick={() => void choose(issue.id, 'keep-this-device')}
                    className="mt-3 rounded-lg bg-blue-600 px-3 py-1.5 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {messages().sync.issues.keepThisReplace}
                  </button>
                ) : (
                  <p className="mt-2 text-slate-600">{messages().sync.issues.nothingChanged}</p>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
