import type { ReactNode } from 'react'

interface SettingsGroupProps {
  title: string
  /** One short line under the title saying what is inside. */
  description: string
  /** Shows the title in red (danger zone). */
  danger?: boolean
  children: ReactNode
}

/**
 * A collapsed-by-default section of the Settings & Data page. Uses the
 * native <details> element: the panels inside stay mounted while it is
 * closed, so automatic imports keep running and a half-finished import
 * is not lost when the section is closed.
 */
export function SettingsGroup({ title, description, danger = false, children }: SettingsGroupProps) {
  return (
    <details className="group rounded-xl border border-slate-200 bg-white shadow-sm">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-5 [&::-webkit-details-marker]:hidden">
        <span>
          <span className={`block text-base font-semibold ${danger ? 'text-red-700' : 'text-slate-900'}`}>
            {title}
          </span>
          <span className="mt-0.5 block text-sm text-slate-500">{description}</span>
        </span>
        <span aria-hidden="true" className="text-slate-400 transition-transform group-open:rotate-90">
          ▸
        </span>
      </summary>

      <div className="space-y-6 border-t border-slate-200 p-4 sm:p-5">{children}</div>
    </details>
  )
}
