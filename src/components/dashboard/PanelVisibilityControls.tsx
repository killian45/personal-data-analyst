import { messages } from '../../i18n'

export interface PanelChoice {
  id: string
  title: string
}

interface PanelVisibilityControlsProps {
  panels: readonly PanelChoice[]
  hidden: ReadonlySet<string>
  onChange: (id: string, hide: boolean) => void
  onShowAll: () => void
}

/**
 * "Show or hide panels": one checkbox per Dashboard panel (ticked =
 * shown). Hiding only removes the panel from view; nothing is deleted.
 */
export function PanelVisibilityControls({ panels, hidden, onChange, onShowAll }: PanelVisibilityControlsProps) {
  const t = messages()
  const hiddenCount = panels.filter((panel) => hidden.has(panel.id)).length
  return (
    <details className="rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
      <summary className="cursor-pointer font-medium">
        {t.dashboard.showOrHidePanels(hiddenCount)}
      </summary>
      <fieldset className="mt-3">
        <legend className="sr-only">{t.dashboard.panelsShown}</legend>
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {panels.map((panel) => (
            <li key={panel.id}>
              <label className="flex cursor-pointer items-center gap-2">
                <input type="checkbox" checked={!hidden.has(panel.id)} onChange={(event) => onChange(panel.id, !event.target.checked)} />
                <span className="break-words">{panel.title}</span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
      {hiddenCount > 0 && (
        <button type="button" onClick={onShowAll} className="mt-3 rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-slate-100">
          {t.dashboard.showAll}
        </button>
      )}
    </details>
  )
}
