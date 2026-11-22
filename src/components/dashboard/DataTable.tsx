import { messages } from '../../i18n'

export interface DataRow {
  label: string
  value: string
  detail?: string
}

/**
 * The values behind a chart, as a table (the accessible alternative to
 * hovering, and the trace from chart to records).
 */
export function DataTable({
  caption,
  rows,
  detailHeader,
  firstHeader,
}: {
  caption: string
  rows: DataRow[]
  detailHeader?: string
  firstHeader?: string
}) {
  const t = messages()
  return (
    <details className="rounded-lg border border-slate-200 text-sm">
      <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-slate-600">
        {t.dashboard.withRows(t.dashboard.showData, rows.length)}
      </summary>
      <div className="max-h-72 overflow-auto border-t border-slate-200">
        <table className="min-w-full text-left text-xs">
          <caption className="sr-only">{caption}</caption>
          <thead className="text-slate-500">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">{firstHeader ?? t.dashboard.period}</th>
              <th scope="col" className="px-3 py-2 font-medium">{t.dashboard.value}</th>
              {detailHeader && <th scope="col" className="px-3 py-2 font-medium">{detailHeader}</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className="border-t border-slate-200">
                <td className="whitespace-nowrap px-3 py-1.5">{row.label}</td>
                <td className="whitespace-nowrap px-3 py-1.5 tabular-nums">{row.value}</td>
                {detailHeader && <td className="px-3 py-1.5 text-slate-600">{row.detail ?? ''}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}
