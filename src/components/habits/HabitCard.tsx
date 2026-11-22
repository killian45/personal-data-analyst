import type { DragEvent } from 'react'

import type { CreateEntryInput } from '../../database/entries'
import type { ActiveTimer, Habit } from '../../database/types'
import { resolveDisplayZone } from '../../settings/displayTimezone'
import type { DisplayTimezone } from '../../settings/displayTimezone'
import { timerElapsedMs } from '../../stopwatch/duration'
import { formatElapsedTime } from '../../stopwatch/formatElapsed'
import { formatInTimezone, getDeviceTimezone } from '../../time/time'
import { EntryLogger } from '../EntryLogger'
import { StopwatchSessionLogger } from '../StopwatchSessionLogger'

import { habitTypeLabel } from './habitTypes'
import { messages } from '../../i18n'

/** One habit on the Data Logging page: details, quick logging, stopwatch, edit/archive/delete, reordering. */

interface HabitCardProps {
  habit: Habit
  activeTimer?: ActiveTimer
  now: number
  displayTimezone: DisplayTimezone
  busy: boolean
  onEdit: (habit: Habit) => void
  onArchive: (habit: Habit) => void
  onDelete: (habit: Habit) => void
  onStart: (habit: Habit) => void
  onStop: (habit: Habit) => void
  onCancel: (habit: Habit) => void
  onCreateEntry: (input: CreateEntryInput) => Promise<unknown>
  onCreateEntries: (inputs: CreateEntryInput[]) => Promise<unknown>
  onUpdateLabelOptions: (habit: Habit, labelOptions: string[]) => Promise<unknown>

  position: number
  totalActiveHabits: number
  dragged: boolean
  onMoveUp: () => void
  onMoveDown: () => void
  onDragStart: (event: DragEvent<HTMLButtonElement>) => void
  onDrop: (event: DragEvent<HTMLElement>) => void
  onDragEnd: () => void
}

export function HabitCard({
  habit,
  activeTimer,
  now,
  displayTimezone,
  busy,
  onEdit,
  onArchive,
  onDelete,
  onStart,
  onStop,
  onCancel,
  onCreateEntry,
  onCreateEntries,
  onUpdateLabelOptions,

  position,
  totalActiveHabits,
  dragged,
  onMoveUp,
  onMoveDown,
  onDragStart,
  onDrop,
  onDragEnd,
}: HabitCardProps) {
  const t = messages()
  const typeLabel = habitTypeLabel(habit.type)

  const elapsedMilliseconds = activeTimer
    ? timerElapsedMs(activeTimer, now)
    : 0

  // Pause/resume was removed (PROJECT_SPEC.md §4.4). A timer paused with
  // an earlier version can still be stopped (it ends at the pause) or
  // cancelled.
  const pausedByEarlierVersion = activeTimer?.runningSince === null

  return (
    <article
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
      className={`rounded-lg border p-4 transition-colors ${
        dragged
          ? 'border-blue-500 bg-blue-50 opacity-50'
          : 'border-slate-200'
      }`}
    >
      <div className="flex items-start gap-3">
              {!habit.archived && (
          <div className="flex shrink-0 flex-col items-center gap-1">
            <button
              type="button"
              draggable
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              aria-label={t.habitCard.dragToReorderNamed(habit.name)}
              title={t.habitCard.dragToReorder}
              className="cursor-grab rounded border border-slate-300 px-2 py-1 text-sm hover:bg-slate-100 active:cursor-grabbing"
            >
              ⋮⋮
            </button>

            <button
              type="button"
              onClick={onMoveUp}
              disabled={position <= 0}
              aria-label={t.habitCard.moveUp(habit.name)}
              className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-30"
            >
              ↑
            </button>

            <button
              type="button"
              onClick={onMoveDown}
              disabled={position === totalActiveHabits - 1}
              aria-label={t.habitCard.moveDown(habit.name)}
              className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-30"
            >
              ↓
            </button>
          </div>
        )}
        <div
          className="mt-1 h-4 w-4 shrink-0 rounded-full"
          style={{ backgroundColor: habit.color }}
          aria-hidden="true"
        />

        <div className="min-w-0 flex-1">
          <h3 className="break-words font-medium">
            {habit.name}
          </h3>

          <p className="mt-1 text-xs text-slate-500">
            {typeLabel}
            {habit.unit ? ` · ${habit.unit}` : ''}
            {habit.type === 'number' && habit.dailyAggregation === 'mean' ? t.habitCard.dailyAverage : ''}
            {habit.type === 'number' && habit.target !== null ? t.habitCard.target(`${habit.target}${habit.unit ? ` ${habit.unit}` : ''}`) : ''}
            {habit.archived ? t.habitCard.archived : ''}
          </p>

          {habit.type === 'label' && habit.labelOptions && (
            <p className="mt-2 text-xs text-slate-500">
              {t.habitCard.options(habit.labelOptions.join(', '))}
            </p>
          )}

          {habit.type !== 'stopwatch' && !habit.archived && (
            <EntryLogger
              habit={habit}
              onCreateEntry={onCreateEntry}
              onCreateEntries={onCreateEntries}
              onUpdateLabelOptions={(labelOptions) =>
                onUpdateLabelOptions(habit, labelOptions)
              }
            />
          )}

          {habit.type === 'stopwatch' && (
            <div className="mt-4 rounded-lg bg-slate-50 p-4">
              {activeTimer ? (
                <>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    {pausedByEarlierVersion ? t.habitCard.stopwatchPaused : t.habitCard.stopwatchRunning}
                  </p>

                  {pausedByEarlierVersion && (
                    <p className="mt-1 text-xs text-slate-500">
                      {t.habitCard.pausedByEarlierVersion}
                    </p>
                  )}

                  <p
                    className="mt-2 font-mono text-2xl font-semibold tabular-nums"
                    aria-live="off"
                  >
                    {formatElapsedTime(elapsedMilliseconds)}
                  </p>

                  <p className="mt-1 text-xs text-slate-500">
                    {t.habitCard.started}{' '}
                    {formatInTimezone(
                      activeTimer.startedAt,
                      resolveDisplayZone(displayTimezone, activeTimer.timezone),
                      'd MMM yyyy, HH:mm',
                    )}
                    {(displayTimezone === 'event'
                      ? activeTimer.timezone !== getDeviceTimezone()
                      : activeTimer.timezone !==
                        resolveDisplayZone(displayTimezone, activeTimer.timezone)) &&
                      t.habitCard.recordedIn(activeTimer.timezone)}
                  </p>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => onStop(habit)}
                      disabled={busy}
                      className="rounded-md bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      {busy ? t.habitCard.processing : t.habitCard.stopAndSave}
                    </button>

                    <button
                      type="button"
                      onClick={() => onCancel(habit)}
                      disabled={busy}
                      className="rounded-md border border-slate-300 px-3 py-2 text-xs font-medium hover:bg-white disabled:opacity-50"
                    >
                      {t.habitCard.cancelTimer}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-sm text-slate-600">
                    {t.habitCard.noActiveStopwatch}
                  </p>

                  {!habit.archived && (
                    <button
                      type="button"
                      onClick={() => onStart(habit)}
                      disabled={busy}
                      className="mt-3 rounded-md bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      {busy ? t.habitCard.starting : t.habitCard.startStopwatch}
                    </button>
                  )}
                </>
              )}

              {!habit.archived && (
                <StopwatchSessionLogger
                  habit={habit}
                  onCreateEntry={onCreateEntry}
                />
              )}
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onEdit(habit)}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-slate-50"
            >
              {t.common.edit}
            </button>

            <button
              type="button"
              onClick={() => onArchive(habit)}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-slate-50"
            >
              {habit.archived ? t.habitCard.restore : t.habitCard.archive}
            </button>

            <button
              type="button"
              onClick={() => onDelete(habit)}
              className="rounded-md border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
            >
              {t.common.delete}
            </button>
          </div>
        </div>
      </div>
    </article>
  )
}
