import type { HabitType } from '../../database/types'
import { messages } from '../../i18n'

/** The habit types offered in the habit form, in this order. */
export const HABIT_TYPES: readonly HabitType[] = ['number', 'checkbox', 'stopwatch', 'label', 'text']

/** Display name of a habit type in the current language. */
export function habitTypeLabel(type: HabitType): string {
  return messages().habitTypes[type]
}

/** Values of the create/edit habit form (text as typed). */
export interface HabitFormValues {
  name: string
  type: HabitType
  unit: string
  labelOptions: string
  color: string
  dailyAggregation: 'sum' | 'mean'
  target: string
}

export const INITIAL_FORM: HabitFormValues = {
  name: '',
  type: 'number',
  unit: '',
  labelOptions: '',
  color: '#2563eb',
  dailyAggregation: 'sum',
  target: '',
}
