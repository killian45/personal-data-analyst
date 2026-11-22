import { messages } from '../i18n'
import { MAX_LABEL_OPTION_LENGTH } from '../database/validation'

/**
 * Pure helpers for category (label) habits: choosing several options at
 * once and adding/removing options from the logging panel.
 *
 * The database layer re-checks everything (validateHabitDefinition, and
 * updateHabit refuses to remove options used by existing entries); these
 * helpers only give early, clear messages.
 */

/**
 * Adds or removes an option from the selection. The result keeps the
 * order of the habit's options, so entries are saved in a stable order.
 */
export function toggleLabelSelection(
  options: readonly string[],
  selected: readonly string[],
  option: string,
): string[] {
  const next = new Set(selected)

  if (next.has(option)) {
    next.delete(option)
  } else {
    next.add(option)
  }

  return options.filter((item) => next.has(item))
}

/**
 * Returns the options with a new one appended.
 *
 * Commas are refused because the habit Edit form separates options with
 * commas: a label containing one could not be edited there afterwards.
 */
export function addLabelOption(
  options: readonly string[],
  rawName: string,
): string[] {
  const name = rawName.trim()

  if (name.length === 0) {
    throw new Error(messages().inputText.labelName)
  }

  if (name.includes(',')) {
    throw new Error(messages().inputText.labelComma)
  }

  if (name.length > MAX_LABEL_OPTION_LENGTH) {
    throw new Error(
      messages().inputText.labelTooLong(MAX_LABEL_OPTION_LENGTH),
    )
  }

  const lower = name.toLocaleLowerCase()
  const existing = options.find(
    (option) => option.toLocaleLowerCase() === lower,
  )

  if (existing !== undefined) {
    throw new Error(messages().inputText.labelExists(existing))
  }

  return [...options, name]
}

/** Returns the options without the given one; at least one must remain. */
export function removeLabelOption(
  options: readonly string[],
  option: string,
): string[] {
  const next = options.filter((item) => item !== option)

  if (next.length === options.length) {
    throw new Error(messages().inputText.labelMissing(option))
  }

  if (next.length === 0) {
    throw new Error(messages().inputText.labelLast)
  }

  return next
}
