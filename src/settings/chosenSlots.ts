/**
 * A choice of up to N items (apps, spending categories) stored as COLOUR
 * SLOTS: position = colour in the chart palette, null = a free slot left
 * by a removed item, so removing one item never repaints the others
 * (dataviz rule: colour follows the entity). Pure functions.
 */

export type ChosenSlots = (string | null)[]

export function trimSlots(slots: ChosenSlots): ChosenSlots {
  const copy = [...slots]
  while (copy.length > 0 && copy[copy.length - 1] === null) copy.pop()
  return copy
}

/** Reads a stored choice; older values (names only) still read. null = invalid. */
export function parseSlots(text: string, max: number): ChosenSlots | null {
  try {
    const value: unknown = JSON.parse(text)
    if (
      !Array.isArray(value) ||
      value.length > max ||
      value.some((name) => name !== null && (typeof name !== 'string' || name.trim() === '' || name.length > 200))
    ) {
      return null
    }
    const names = value.filter((name): name is string => name !== null)
    if (new Set(names).size !== names.length) return null
    return trimSlots(value as ChosenSlots)
  } catch {
    return null
  }
}

/** The chosen names, in slot order. */
export function chosenNames(slots: ChosenSlots): string[] {
  return slots.filter((name): name is string => name !== null)
}

/** Adds an item in the first free slot, or removes it (its slot becomes free). */
export function toggleSlot(slots: ChosenSlots, name: string, max: number): ChosenSlots {
  const index = slots.indexOf(name)
  if (index >= 0) {
    const next = [...slots]
    next[index] = null
    return trimSlots(next)
  }
  if (chosenNames(slots).length >= max) return slots
  const free = slots.indexOf(null)
  if (free >= 0) {
    const next = [...slots]
    next[free] = name
    return next
  }
  return [...slots, name]
}
