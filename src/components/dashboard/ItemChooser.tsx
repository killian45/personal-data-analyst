import { useId, useState } from 'react'

import { foldForSearch } from '../../crm/contactForm'
import { messages } from '../../i18n'

export interface ChooserItem {
  name: string
  /** Shown on the right, e.g. the time or amount in the shown dates. */
  detail: string
}

export interface ChooserTexts {
  /** What is shown when nothing is chosen, e.g. "total screen time". */
  nothingChosen: string
  open: string
  close: string
  clear: string
  search: string
  /** Accessible name of the list, e.g. "Apps". */
  list: string
  hint: string
  empty: string
}

interface ItemChooserProps {
  /** Most relevant first (e.g. most used in the shown dates). */
  items: readonly ChooserItem[]
  chosen: readonly string[]
  max: number
  texts: ChooserTexts
  onToggle: (name: string) => void
  onClear: () => void
  /** Kept by the Dashboard, so the list stays open when the panel changes. */
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Chooses which items a panel shows (apps for screen time, categories
 * for spending): nothing chosen = the overall view. Searchable list with
 * a checkbox per item, at most `max` (one colour each).
 */
export function ItemChooser({ items, chosen, max, texts, onToggle, onClear, open, onOpenChange }: ItemChooserProps) {
  const id = useId()
  const [query, setQuery] = useState('')
  const words = foldForSearch(query).split(/\s+/).filter(Boolean)
  const shown = items.filter((item) => words.every((word) => foldForSearch(item.name).includes(word))).slice(0, 100)
  const chosenSet = new Set(chosen)
  const full = chosen.length >= max

  return (
    <div className="space-y-2 text-sm">
      <p>
        {messages().dashboard.showing} <span className="font-medium">{chosen.length === 0 ? texts.nothingChosen : chosen.join(', ')}</span>
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => onOpenChange(!open)}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-slate-100"
        >
          {open ? texts.close : texts.open}
        </button>
        {chosen.length > 0 && (
          <button type="button" onClick={onClear} className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-slate-100">
            {texts.clear}
          </button>
        )}
      </div>

      {open && (
        <div className="space-y-2 rounded-lg border border-slate-200 p-3">
          <label htmlFor={`${id}-search`} className="block text-xs font-medium text-slate-600">{texts.search}</label>
          <input
            id={`${id}-search`}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
          />
          <p className="text-xs text-slate-500">{texts.hint}</p>
          {items.length === 0 ? (
            <p className="text-xs text-slate-500">{texts.empty}</p>
          ) : (
            <ul aria-label={texts.list} className="max-h-64 overflow-y-auto rounded-md border border-slate-200">
              {shown.map((item) => (
                <li key={item.name} className="border-b border-slate-200 last:border-b-0">
                  <label className="flex cursor-pointer items-center gap-2 px-3 py-2 hover:bg-slate-50">
                    <input
                      type="checkbox"
                      checked={chosenSet.has(item.name)}
                      disabled={full && !chosenSet.has(item.name)}
                      onChange={() => onToggle(item.name)}
                    />
                    <span className="min-w-0 flex-1 truncate">{item.name}</span>
                    <span className="shrink-0 text-xs text-slate-500 tabular-nums">{item.detail}</span>
                  </label>
                </li>
              ))}
              {shown.length === 0 && <li className="px-3 py-2 text-xs text-slate-500">{messages().dashboard.nothingMatches}</li>}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
