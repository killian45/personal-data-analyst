import { messages } from '../i18n'
import { cleanComment } from './commentTemplate'
import type { CreateEntryInput } from '../database/entries'
import type { EntryValue, Habit } from '../database/types'
import { localDateTimeToUtc } from '../time/time'

/**
 * Converts what the user entered in the logging form into the input of
 * createEntry. Pure function: no database or interface access.
 *
 * Final validation still happens in the database layer; this function
 * only interprets the raw form fields and reports clear errors early.
 */

export interface EntryFormState {
  /**
   * number/text: the text typed by the user.
   * checkbox: true or false.
   * label: the chosen option.
   */
  rawValue: string | boolean

  /**
   * Wall-clock date and time in the entry timezone ("YYYY-MM-DDTHH:mm"),
   * or null to use the current moment.
   */
  localDateTime: string | null

  /** IANA timezone in which the event happened. */
  timezone: string

  comment: string
}

export interface BuiltEntry {
  input: CreateEntryInput

  /**
   * True when the chosen local time occurs twice in the timezone
   * (clocks going back); the earlier occurrence was used.
   */
  ambiguousTime: boolean
}

const DECIMAL_NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/

/**
 * Parses a number typed by the user.
 *
 * - Accepts a dot or a comma as decimal separator ("2.5" or "2,5").
 * - Rejects empty input, thousands separators, letters and exponents.
 */
export function parseNumberInput(raw: string): number {
  const text = raw.trim().replace(',', '.')

  if (text.length === 0) {
    throw new Error(messages().inputText.enterNumber)
  }

  if (!DECIMAL_NUMBER.test(text)) {
    throw new Error(messages().inputText.validNumber)
  }

  const value = Number(text)

  if (!Number.isFinite(value)) {
    throw new Error(messages().inputText.validNumber)
  }

  return value
}

/**
 * Reads the value entered for a habit (number, checkbox, label or text)
 * and reports a clear error when it is missing or invalid.
 */
export function parseFormValue(
  habit: Habit,
  rawValue: string | boolean,
): EntryValue {
  switch (habit.type) {
    case 'number':
      return parseNumberInput(String(rawValue))

    case 'checkbox':
      if (typeof rawValue !== 'boolean') {
        throw new Error(messages().inputText.chooseDone)
      }
      return rawValue

    case 'label':
      if (typeof rawValue !== 'string' || rawValue === '') {
        throw new Error(messages().inputText.chooseOption)
      }
      return rawValue

    case 'text': {
      const text = String(rawValue).trim()

      if (text.length === 0) {
        throw new Error(messages().inputText.enterText)
      }

      return text
    }

    case 'stopwatch':
      throw new Error(messages().inputText.useStopwatch)
  }
}

export function buildEntryInput(
  habit: Habit,
  form: EntryFormState,
  now: Date = new Date(),
): BuiltEntry {
  const value = parseFormValue(habit, form.rawValue)

  let occurredStart = now.toISOString()
  let ambiguousTime = false

  if (form.localDateTime !== null) {
    const converted = localDateTimeToUtc(form.localDateTime, form.timezone)
    occurredStart = converted.utc
    ambiguousTime = converted.ambiguous
  }

  return {
    input: {
      habitId: habit.id,
      value,
      occurredStart,
      timezone: form.timezone,
      comment: cleanComment(form.comment),
    },
    ambiguousTime,
  }
}
