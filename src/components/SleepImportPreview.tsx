import type { ImportIssue, SleepImportPlan } from '../import/sleepImport'
import { messages } from '../i18n'
import { formatInTimezone, getDeviceTimezone } from '../time/time'

const MAX_LISTED = 50

export function IssueList({ title, issues }: { title: string; issues: ImportIssue[] }) {
  if (issues.length === 0) {
    return null
  }

  return (
    <details className="rounded-lg border border-slate-200 p-3 text-sm">
      <summary className="cursor-pointer font-medium">{messages().imports.groupTitle(title, issues.length)}</summary>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-600">
        {issues.slice(0, MAX_LISTED).map((issue, index) => (
          <li key={`${issue.label}-${index}`}>{messages().imports.issue(issue.label, issue.reason)}</li>
        ))}
      </ul>
      {issues.length > MAX_LISTED && (
        <p className="mt-2 text-xs text-slate-500">{messages().imports.andMore(issues.length - MAX_LISTED)}</p>
      )}
    </details>
  )
}

/**
 * Preview of a sleep import (file or Health Connect on the phone): counts,
 * lists of issues and notes, then Import / Cancel. Nothing is written
 * until "Import" is pressed.
 */
export function SleepImportPreview({
  plan,
  working,
  onImport,
  onCancel,
}: {
  plan: SleepImportPlan
  working: boolean
  onImport: () => void
  onCancel: () => void
}) {
  const t = messages()
  const i = t.imports
  const zone = getDeviceTimezone()
  const rows: [string, number, string][] = [
    [i.willImport, plan.toAdd.length, t.sleepPreview.newSessions],
    [i.skippedDuplicates, plan.duplicates.length, i.alreadyOrTwice],
    [i.needAttention, plan.needsAttention.length, i.notImportedList],
    [i.invalid, plan.invalid.length, i.notImportedReasons],
  ]

  return (
        <div className="mt-4 space-y-4">
          <p className="text-sm">
            <span className="font-medium">{plan.fileName}</span>: {t.sleepPreview.found(plan.found)}
            {plan.firstStartUtc && plan.lastStartUtc
              ? i.fromTo(formatInTimezone(plan.firstStartUtc, zone, 'd MMM yyyy'), formatInTimezone(plan.lastStartUtc, zone, 'd MMM yyyy'))
              : ''}
            .
          </p>

          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="min-w-full text-left text-sm">
              <tbody>
                {rows.map(([label, count, note]) => (
                  <tr key={label} className="border-b border-slate-200 last:border-b-0">
                    <th scope="row" className="px-3 py-2 font-normal">{label}</th>
                    <td className="px-3 py-2 tabular-nums font-semibold">{count}</td>
                    <td className="px-3 py-2 text-xs text-slate-500">{note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <IssueList title={i.needAttention} issues={plan.needsAttention} />
          <IssueList title={i.invalidNotImported} issues={plan.invalid} />
          <IssueList title={i.skippedDuplicates} issues={plan.duplicates} />

          {plan.notes.length > 0 && (
            <ul className="list-disc space-y-1 pl-5 text-xs text-slate-600">
              {plan.notes.map((note) => <li key={note}>{note}</li>)}
            </ul>
          )}

          {plan.otherData.length > 0 && (
            <details className="rounded-lg border border-slate-200 p-3 text-sm">
              <summary className="cursor-pointer font-medium">{t.sleepPreview.otherData(plan.otherData.length)}</summary>
              <p className="mt-2 text-xs text-slate-600">
                {plan.otherData.map((item) => i.labelCount(item.label, item.count)).join(', ')}
              </p>
            </details>
          )}

          {plan.toAdd.length === 0 && (
            <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">{i.nothingNew}</p>
          )}

          <div className="flex flex-wrap gap-2">
            {plan.toAdd.length > 0 && (
              <button
                type="button"
                disabled={working}
                onClick={onImport}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {working ? i.importingDots : t.sleepPreview.importCount(plan.toAdd.length)}
              </button>
            )}
            <button
              type="button"
              disabled={working}
              onClick={onCancel}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-100 disabled:opacity-50"
            >
              {t.common.cancel}
            </button>
          </div>
        </div>
  )
}
