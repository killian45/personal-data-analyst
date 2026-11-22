export interface Tile {
  /** Choice id for optional tiles ("extra:…"). */
  id?: string
  label: string
  value: string
  /** Optional small note under the value. */
  note?: string
}

/** A grid of stat tiles: label, value (proportional figures), note. */
export function StatTiles({ tiles }: { tiles: Tile[] }) {
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {tiles.map((tile) => (
        <div key={tile.label} className="rounded-lg border border-slate-200 p-3">
          <dt className="text-xs text-slate-500">{tile.label}</dt>
          <dd className="mt-1 text-lg font-semibold text-slate-900">{tile.value}</dd>
          {tile.note && <dd className="mt-0.5 text-xs text-slate-500">{tile.note}</dd>}
        </div>
      ))}
    </dl>
  )
}
