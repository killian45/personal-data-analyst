import type { DateRange } from '../../stats/delta'
import { rangeLength, smallStep } from '../../dashboard/periods'
import { messages } from '../../i18n'

interface PeriodNavigatorProps {
  range: DateRange
  today: string
  label: string
  /** Moves by `days` (negative = earlier). */
  onMove: (days: number) => void
  /** Shown when the range does not end today. */
  onToday: () => void
}

const button =
  'rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40'

/**
 * Arrows to move through periods: « » by the whole range, ‹ › by a small
 * step; on touch screens the same moves work by swiping (see Dashboard).
 */
export function PeriodNavigator({ range, today, label, onMove, onToday }: PeriodNavigatorProps) {
  const t = messages().dashboard
  const full = rangeLength(range)
  const small = smallStep(range)
  const atToday = range.end >= today
  return (
    <nav aria-label={t.moveThroughPeriods} className="flex flex-wrap items-center gap-2">
      <button type="button" className={button} aria-label={t.previousDays(full)} title={t.previousDays(full)} onClick={() => onMove(-full)}>«</button>
      <button type="button" className={button} aria-label={t.daysEarlier(small)} title={t.daysEarlier(small)} onClick={() => onMove(-small)}>‹</button>
      <span className="min-w-0 text-sm font-medium tabular-nums">{label}</span>
      <button type="button" className={button} aria-label={t.daysLater(small)} title={t.daysLater(small)} disabled={atToday} onClick={() => onMove(small)}>›</button>
      <button type="button" className={button} aria-label={t.nextDays(full)} title={t.nextDays(full)} disabled={atToday} onClick={() => onMove(full)}>»</button>
      {!atToday && (
        <button type="button" className={button} onClick={onToday}>{t.backToToday}</button>
      )}
    </nav>
  )
}
