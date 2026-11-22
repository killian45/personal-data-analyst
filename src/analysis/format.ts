import { formatAxisHours } from '../sleep/engine/localTime'
import { formatDuration } from '../stopwatch/duration'
import { formatNumber, messages } from '../i18n'

import type { Measure } from './measures'

/** A measure's value for display: durations as h/min, clock times as HH:mm, checkboxes as Done. */
export function formatMeasureValue(measure: Measure, value: number): string {
  switch (measure.kind) {
    case 'duration':
      return value < 0 ? `−${formatDuration(-value * 3_600_000)}` : formatDuration(value * 3_600_000)
    case 'clock':
      return formatAxisHours(value)
    case 'binary':
      return value >= 0.5 ? messages().measures.done : messages().measures.notDone
    case 'number': {
      const text = formatNumber(value)
      return measure.unit ? `${text} ${measure.unit}` : text
    }
  }
}
