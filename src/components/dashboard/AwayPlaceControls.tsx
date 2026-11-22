import { useId, useState } from 'react'

import type { PlaceSummary } from '../../location/dailyLocation'
import { mapUrl, placeLabel } from '../../location/places'
import { messages } from '../../i18n'

function hoursText(ms: number): string {
  const hours = ms / 3_600_000
  return hours < 10 ? `${hours.toFixed(1)} h` : `${Math.round(hours)} h`
}

/**
 * "Time in…" / "Time away from…": choose a place (most time first), give it a name,
 * or look it up on OpenStreetMap (user decisions 2026-11-11).
 */
export function AwayPlaceControls({
  label,
  places,
  selectedKey,
  names,
  onSelect,
  onRename,
}: {
  /** "In" or "From". */
  label: string
  places: readonly PlaceSummary[]
  selectedKey: string
  names: Readonly<Record<string, string>>
  onSelect: (key: string) => void
  onRename: (key: string, name: string) => Promise<void>
}) {
  const id = useId()
  const selected = places.find((place) => place.key === selectedKey)
  const t = messages()
  const [draft, setDraft] = useState<{ key: string; text: string } | null>(null)
  const [message, setMessage] = useState('')
  const text = draft?.key === selectedKey ? draft.text : (names[selectedKey] ?? '')

  async function save() {
    setMessage('')
    try {
      await onRename(selectedKey, text)
      setDraft(null)
      setMessage(text.trim() === '' ? t.dashboard.location.nameRemoved : t.dashboard.location.nameSaved)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t.dashboard.location.nameSaveFailed)
    }
  }

  if (!selected) return null

  return (
    <div className="mt-2 space-y-2 text-sm">
      <label className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-slate-600">{label}</span>
        <select
          value={selectedKey}
          onChange={(event) => {
            setMessage('')
            onSelect(event.target.value)
          }}
          className="max-w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
        >
          {places.map((place) => (
            <option key={place.key} value={place.key}>
              {t.dashboard.location.placeOption(placeLabel(place, names), place.days, hoursText(place.totalMs))}
            </option>
          ))}
        </select>
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={`${id}-name`} className="text-xs font-medium text-slate-600">{t.dashboard.location.nameThisPlace}</label>
        <input
          id={`${id}-name`}
          type="text"
          maxLength={100}
          value={text}
          placeholder={placeLabel(selected, {})}
          onChange={(event) => setDraft({ key: selectedKey, text: event.target.value })}
          className="w-44 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
        />
        <button
          type="button"
          onClick={() => void save()}
          className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium hover:bg-slate-100"
        >
          {t.dashboard.location.saveName}
        </button>
        <a
          href={mapUrl(selected.lat, selected.lng)}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-blue-700 underline"
        >
          {t.dashboard.location.showOnMap}
        </a>
      </div>
      <p className="text-xs text-slate-500">
        {t.dashboard.location.mapNote}
        {message && <span role="status" className="ml-1 text-slate-700">{message}</span>}
      </p>
    </div>
  )
}
