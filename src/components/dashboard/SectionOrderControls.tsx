import { messages } from '../../i18n'

/** Moving a habit section up or down (null: already first / last). */
export interface SectionOrder {
  onMoveUp: (() => void) | null
  onMoveDown: (() => void) | null
}

const buttonClass =
  'rounded-md border border-slate-300 px-2 py-1 text-sm leading-none hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40'

/**
 * Up / down buttons for re-arranging habits on the Dashboard. They change
 * the same habit order as the Data Logging page (one shared order).
 * Buttons rather than dragging, so they also work on touch screens.
 */
export function SectionOrderControls({ title, order }: { title: string; order: SectionOrder }) {
  const t = messages().dashboard
  return (
    <div className="flex shrink-0 gap-1">
      <button
        type="button"
        className={buttonClass}
        aria-label={t.moveUpNamed(title)}
        title={t.moveUp}
        disabled={!order.onMoveUp}
        onClick={() => order.onMoveUp?.()}
      >
        ↑
      </button>
      <button
        type="button"
        className={buttonClass}
        aria-label={t.moveDownNamed(title)}
        title={t.moveDown}
        disabled={!order.onMoveDown}
        onClick={() => order.onMoveDown?.()}
      >
        ↓
      </button>
    </div>
  )
}
