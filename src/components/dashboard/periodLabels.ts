import type { Aggregation } from '../../dashboard/periods'
import { format } from 'date-fns'

import { dateLocale, messages } from '../../i18n'

/** A calendar date (yyyy-mm-dd) in a fixed pattern, with names in the app's language. */
function named(date: string, pattern: string): string {
  const { year, month, day } = parts(date)
  return format(new Date(year, month - 1, day), pattern, { locale: dateLocale() })
}

function parts(date: string) {
  const [year, month, day] = date.split('-').map(Number)
  return { year, month, day }
}

/** Short axis label: "9 Nov" for days and weeks, "Nov 2026" for months. */
export function shortPeriodLabel(period: string, aggregation: Aggregation): string {
  return named(period, aggregation === 'month' ? 'MMM yyyy' : 'd MMM')
}

/** Full label for tooltips and tables. */
export function fullPeriodLabel(period: string, aggregation: Aggregation): string {
  const date = named(period, 'd MMM yyyy')

  if (aggregation === 'week') {
    return messages().dashboard.weekOf(date)
  }

  return aggregation === 'month' ? named(period, 'MMM yyyy') : date
}

/** "12 Oct – 10 Nov 2026" style range label. */
export function rangeLabel(start: string, end: string): string {
  const left = parts(start).year === parts(end).year ? named(start, 'd MMM') : named(start, 'd MMM yyyy')
  return `${left} – ${named(end, 'd MMM yyyy')}`
}
