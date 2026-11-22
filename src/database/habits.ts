
import { db } from './db'
import { messages } from '../i18n'
import { initialSyncFields, nextSyncFields } from './sync'
import type { Habit } from './types'
import { validateHabitDefinition } from './validation'

import type { HabitDefinitionInput } from './validation'

export type CreateHabitInput = HabitDefinitionInput

export type UpdateHabitInput = Partial<CreateHabitInput>

async function getNextSortOrder(): Promise<number> {
  const activeHabits = await db.habits
    .filter((habit) => habit.deletedAt === null && !habit.archived)
    .toArray()

  if (activeHabits.length === 0) {
    return 0
  }

  return Math.max(...activeHabits.map((habit) => habit.sortOrder)) + 1
}

export async function createHabit(
  input: CreateHabitInput,
): Promise<Habit> {
  const normalized = validateHabitDefinition(input)
  const now = new Date().toISOString()

  return db.transaction('rw', db.habits, async () => {
    const habit: Habit = {
      id: crypto.randomUUID(),
      ...normalized,
      archived: false,
      sortOrder: await getNextSortOrder(),
      ...initialSyncFields(),
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    }

    await db.habits.add(habit)

    return habit
  })
}

/**
 * Ensures that a habit change cannot make existing data invalid.
 *
 * Soft-deleted entries are included because they can be restored
 * (for example by "undo"), so they must remain valid as well.
 *
 * Rules:
 * - The type cannot change once the habit has any entries.
 * - The type cannot change while a stopwatch is running.
 * - Label options used by existing entries cannot be removed or
 *   renamed. New options can always be added.
 */
async function assertExistingDataRemainsValid(
  existingHabit: Habit,
  updatedFields: Pick<Habit, 'type' | 'labelOptions'>,
): Promise<void> {
  const entries = await db.entries
    .where('habitId')
    .equals(existingHabit.id)
    .toArray()

  if (updatedFields.type !== existingHabit.type) {
    if (entries.length > 0) {
      throw new Error(
        messages().dbText.typeHasEntries,
      )
    }

    if (await db.activeTimers.get(existingHabit.id)) {
      throw new Error(
        messages().dbText.stopBeforeType,
      )
    }

    return
  }

  if (updatedFields.type === 'label') {
    const newOptions = new Set(updatedFields.labelOptions ?? [])

    const usedOptionsBeingRemoved = [
      ...new Set(
        entries
          .map((entry) => entry.value)
          .filter(
            (value): value is string =>
              typeof value === 'string' && !newOptions.has(value),
          ),
      ),
    ]

    if (usedOptionsBeingRemoved.length > 0) {
      throw new Error(
        messages().dbText.optionsInUse(usedOptionsBeingRemoved.join(', ')),
      )
    }
  }
}

export async function updateHabit(
  id: string,
  changes: UpdateHabitInput,
): Promise<Habit> {
  return db.transaction(
    'rw',
    db.habits,
    db.entries,
    db.activeTimers,
    async () => {
      const existingHabit = await db.habits.get(id)

      if (!existingHabit || existingHabit.deletedAt !== null) {
        throw new Error(messages().dbText.habitNotFound)
      }

      const updatedFields = validateHabitDefinition({
        name: changes.name ?? existingHabit.name,
        type: changes.type ?? existingHabit.type,
        unit: changes.unit !== undefined
          ? changes.unit
          : existingHabit.unit,
        labelOptions: changes.labelOptions !== undefined
          ? changes.labelOptions
          : existingHabit.labelOptions,
        color: changes.color ?? existingHabit.color,
        dailyAggregation:
          changes.dailyAggregation ??
          (existingHabit.type === 'number' ? existingHabit.dailyAggregation : undefined),
        target:
          changes.target !== undefined
            ? changes.target
            : existingHabit.type === 'number'
              ? existingHabit.target
              : null,
      })

      await assertExistingDataRemainsValid(existingHabit, updatedFields)

      const updatedHabit: Habit = {
        ...existingHabit,
        ...updatedFields,
        ...nextSyncFields(existingHabit),
        updatedAt: new Date().toISOString(),
      }

      await db.habits.put(updatedHabit)

      return updatedHabit
    },
  )
}

export async function setHabitArchived(
  id: string,
  archived: boolean,
): Promise<Habit> {
  return db.transaction('rw', db.habits, db.activeTimers, async () => {
    const existingHabit = await db.habits.get(id)

    if (!existingHabit || existingHabit.deletedAt !== null) {
      throw new Error(messages().dbText.habitNotFound)
    }

    if (archived && await db.activeTimers.get(id)) {
      throw new Error(
        messages().dbText.stopBeforeArchive,
      )
    }

    const sortOrder = archived
      ? existingHabit.sortOrder
      : await getNextSortOrder()

    const updatedHabit: Habit = {
      ...existingHabit,
      archived,
      sortOrder,
      ...nextSyncFields(existingHabit),
      updatedAt: new Date().toISOString(),
    }

    await db.habits.put(updatedHabit)

    return updatedHabit
  })
}

export async function deleteHabit(id: string): Promise<void> {
  await db.transaction('rw', db.habits, db.activeTimers, async () => {
    const existingHabit = await db.habits.get(id)

    if (!existingHabit || existingHabit.deletedAt !== null) {
      throw new Error(messages().dbText.habitNotFound)
    }

    if (await db.activeTimers.get(id)) {
      throw new Error(
        messages().dbText.stopBeforeDelete,
      )
    }

    const now = new Date().toISOString()

    await db.habits.put({
      ...existingHabit,
      ...nextSyncFields(existingHabit),
      deletedAt: now,
      updatedAt: now,
    })
  })
}

/**
 * Restores a soft-deleted habit. Its entries were never deleted with it,
 * so they reappear. An active (non-archived) habit is placed at the end
 * of the custom order.
 */
export async function restoreHabit(id: string): Promise<Habit> {
  return db.transaction('rw', db.habits, async () => {
    const existingHabit = await db.habits.get(id)

    if (!existingHabit) {
      throw new Error(messages().dbText.habitNotFound)
    }

    if (existingHabit.deletedAt === null) {
      throw new Error(messages().dbText.habitNotDeleted)
    }

    const restoredHabit: Habit = {
      ...existingHabit,
      ...nextSyncFields(existingHabit),
      sortOrder: existingHabit.archived
        ? existingHabit.sortOrder
        : await getNextSortOrder(),
      deletedAt: null,
      updatedAt: new Date().toISOString(),
    }

    await db.habits.put(restoredHabit)

    return restoredHabit
  })
}

export async function getAllHabits(): Promise<Habit[]> {
  const habits = await db.habits.toArray()

  return habits
    .filter((habit) => habit.deletedAt === null)
    .sort(
      (a, b) =>
        a.sortOrder - b.sortOrder ||
        a.name.localeCompare(b.name) ||
        a.id.localeCompare(b.id),
    )
}

export async function getActiveHabits(): Promise<Habit[]> {
  const habits = await getAllHabits()

  return habits.filter((habit) => !habit.archived)
}

export async function reorderHabits(
  orderedHabitIds: string[],
): Promise<void> {
  if (new Set(orderedHabitIds).size !== orderedHabitIds.length) {
    throw new Error(messages().dbText.orderDuplicates)
  }

  await db.transaction('rw', db.habits, async () => {
    const activeHabits = await db.habits
      .filter((habit) => habit.deletedAt === null && !habit.archived)
      .toArray()

    const activeIds = new Set(activeHabits.map((habit) => habit.id))

    if (
      orderedHabitIds.length !== activeHabits.length ||
      orderedHabitIds.some((id) => !activeIds.has(id))
    ) {
      throw new Error(
        messages().dbText.orderIncomplete,
      )
    }

    const now = new Date().toISOString()

    const habitsById = new Map(
      activeHabits.map((habit) => [habit.id, habit]),
    )

    await db.habits.bulkPut(
      orderedHabitIds.map((id, index) => {
        const habit = habitsById.get(id)

        if (!habit) {
          throw new Error(messages().dbText.habitNotFound)
        }

        return {
          ...habit,
          sortOrder: index,
          ...nextSyncFields(habit),
          updatedAt: now,
        }
      }),
    )
  })
}
