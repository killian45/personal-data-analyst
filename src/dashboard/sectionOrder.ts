/**
 * Dashboard section order (pure functions).
 *
 * Sections: the three sleep sections, one section per active habit
 * ("habit:<id>"), and "screenTime" when screen-time data exists (Phase 5;
 * placed last unless the user moved it). The saved order fixes WHERE habit sections are placed
 * relative to the sleep sections; WHICH habit fills each habit place
 * always follows the shared habit order (the same as Data Logging). So:
 * - moving a habit past another habit changes the shared habit order;
 * - moving a sleep section, or a habit past a sleep section, changes only
 *   the dashboard layout.
 */

export const SLEEP_SECTION_IDS = ['sleepDuration', 'bedtime', 'wakeTime'] as const
export const SCREEN_TIME_SECTION_ID = 'screenTime'
export const LOCATION_SECTION_ID = 'location'

const isHabit = (id: string) => id.startsWith('habit:')

/**
 * The sections in display order.
 * saved: the stored order (null: never re-arranged → §6.2 default order).
 * habitIds: active habit ids in the shared habit order.
 * options.screenTime / options.location: whether those sections are shown;
 * options.formulaIds: the user's formulas (sections "formula:<id>").
 * New ones go last: screen time, location, then formulas.
 */
export function arrangeSections(
  saved: readonly string[] | null,
  habitIds: readonly string[],
  options: { screenTime?: boolean; location?: boolean; formulaIds?: readonly string[]; healthIds?: readonly string[] } = {},
): string[] {
  const habitSections = habitIds.map((id) => `habit:${id}`)
  const extras = [
    ...(options.screenTime ? [SCREEN_TIME_SECTION_ID] : []),
    ...(options.location ? [LOCATION_SECTION_ID] : []),
    ...(options.healthIds ?? []),
    ...(options.formulaIds ?? []).map((id) => `formula:${id}`),
  ]
  if (!saved) return [...SLEEP_SECTION_IDS, ...habitSections, ...extras]

  const current = new Set<string>([...SLEEP_SECTION_IDS, ...habitSections, ...extras])
  const seen = new Set<string>()
  const layout = saved.filter((id) => {
    if (!current.has(id) || seen.has(id)) return false
    seen.add(id)
    return true
  })

  // Sleep sections missing from the saved order go first (default order);
  // new habits go last.
  const missingSleep = SLEEP_SECTION_IDS.filter((id) => !seen.has(id))
  const habitSlots = layout.filter(isHabit).length
  const extraHabitSlots = habitSections.length - habitSlots
  const missingExtras = extras.filter((id) => !seen.has(id))
  const slots = [
    ...missingSleep,
    ...layout,
    ...Array.from({ length: extraHabitSlots }, () => 'habit:'),
    ...missingExtras,
  ]

  // Fill the habit places in the shared habit order.
  let next = 0
  return slots.map((id) => (isHabit(id) ? habitSections[next++] : id))
}

export type SectionMove =
  | { kind: 'none' }
  /** Two habits swapped: save this shared habit order (habit ids). */
  | { kind: 'habit-order'; habitIds: string[] }
  /** Layout changed: save this section order. */
  | { kind: 'layout'; order: string[] }

/** Moves the section at `index` one place up (-1) or down (+1). */
export function moveSection(arranged: readonly string[], index: number, direction: -1 | 1): SectionMove {
  return swapSections(arranged, index, index + direction)
}

/**
 * Moves a VISIBLE section one place up or down among the visible ones:
 * it swaps places with the next visible section, skipping hidden ones
 * (which keep their own positions).
 */
export function moveVisibleSection(
  arranged: readonly string[],
  hidden: ReadonlySet<string>,
  visibleIndex: number,
  direction: -1 | 1,
): SectionMove {
  const visiblePositions = arranged.flatMap((id, position) => (hidden.has(id) ? [] : [position]))
  const from = visiblePositions[visibleIndex]
  const to = visiblePositions[visibleIndex + direction]
  if (from === undefined || to === undefined) return { kind: 'none' }
  return swapSections(arranged, from, to)
}

/** Swaps two sections (two habits → the shared habit order changes). */
export function swapSections(arranged: readonly string[], index: number, target: number): SectionMove {
  if (index < 0 || index >= arranged.length || target < 0 || target >= arranged.length || index === target) return { kind: 'none' }

  const swapped = [...arranged]
  ;[swapped[index], swapped[target]] = [swapped[target], swapped[index]]

  if (isHabit(arranged[index]) && isHabit(arranged[target])) {
    return { kind: 'habit-order', habitIds: swapped.filter(isHabit).map((id) => id.slice('habit:'.length)) }
  }
  return { kind: 'layout', order: swapped }
}
