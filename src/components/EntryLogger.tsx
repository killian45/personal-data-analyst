import { commentTemplate } from '../logging/commentTemplate'
import { messages } from '../i18n'
import { useId, useState } from 'react'

import type { FormEvent } from 'react'

import type { CreateEntryInput } from '../database/entries'
import type { Habit } from '../database/types'
import { buildEntryInput } from '../logging/buildEntryInput'
import {
  addLabelOption,
  removeLabelOption,
  toggleLabelSelection,
} from '../logging/labelOptions'
import {
  combineDateAndTime,
  invalidDateTimeMessage,
  splitLocalDateTime,
} from '../logging/dateTimeInput'
import {
  formatInTimezone,
  getDeviceTimezone,
  isValidTimezone,
  utcToLocalDateTime,
} from '../time/time'

import { DateTime24Field } from './DateTime24Field'
import { TimezoneField } from './TimezoneField'

interface EntryLoggerProps {
  habit: Habit

  /** Saves the entry. Rejects with an Error whose message is shown. */
  onCreateEntry: (input: CreateEntryInput) => Promise<unknown>

  /**
   * Saves several entries at once, all or none (category habits with
   * several labels chosen). Without it, entries are saved one by one.
   */
  onCreateEntries?: (inputs: CreateEntryInput[]) => Promise<unknown>

  /**
   * Saves a new list of labels for a category habit. Rejects with an
   * Error whose message is shown (e.g. a label used by entries). Without
   * it, labels cannot be edited from the logging panel.
   */
  onUpdateLabelOptions?: (labelOptions: string[]) => Promise<unknown>
}

/**
 * Quick logging for number, checkbox, label and text habits.
 *
 * Common entries need 1–2 interactions:
 * - checkbox: click Done / Not done
 * - label: click one or several options, then "Log"
 * - number / text: type, then press Enter or click Log
 *
 * "More options" reveals date/time, timezone and comment. If the date and
 * time are not changed, the entry uses the moment the user saves it.
 */
export function EntryLogger({
  habit,
  onCreateEntry,
  onCreateEntries,
  onUpdateLabelOptions,
}: EntryLoggerProps) {
  const t = messages()
  const id = useId()

  const [textValue, setTextValue] = useState('')
  const [showOptions, setShowOptions] = useState(false)
  // Date/time fields. Until the user edits them (timeTouched), they only
  // show the current time and the entry uses the moment of saving.
  const [dateText, setDateText] = useState('')
  const [timeText, setTimeText] = useState('')
  const [timeTouched, setTimeTouched] = useState(false)
  const [timezone, setTimezone] = useState(getDeviceTimezone)
  const [comment, setComment] = useState(commentTemplate())

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [confirmation, setConfirmation] = useState('')

  // Category (label) habits: chosen labels and the label editor.
  const labelOptions = habit.type === 'label' ? habit.labelOptions : []
  const [selectedLabels, setSelectedLabels] = useState<string[]>([])
  const [editingLabels, setEditingLabels] = useState(false)
  const [newLabel, setNewLabel] = useState('')
  const [labelBusy, setLabelBusy] = useState(false)
  const [labelError, setLabelError] = useState('')
  // Labels removed elsewhere (e.g. the Edit form) are no longer chosen.
  const chosenLabels = labelOptions.filter((option) =>
    selectedLabels.includes(option),
  )

  async function saveLabelOptions(next: string[]): Promise<boolean> {
    if (!onUpdateLabelOptions || labelBusy) {
      return false
    }

    setLabelError('')
    setLabelBusy(true)

    try {
      await onUpdateLabelOptions(next)
      setSelectedLabels((current) =>
        current.filter((option) => next.includes(option)),
      )
      return true
    } catch (caughtError) {
      setLabelError(
        caughtError instanceof Error
          ? caughtError.message
          : t.entryLogger.labelsSaveFailed,
      )
      return false
    } finally {
      setLabelBusy(false)
    }
  }

  async function handleAddLabel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    let next: string[]

    try {
      next = addLabelOption(labelOptions, newLabel)
    } catch (caughtError) {
      setLabelError(
        caughtError instanceof Error ? caughtError.message : t.entryLogger.invalidLabel,
      )
      return
    }

    if (await saveLabelOptions(next)) {
      setNewLabel('')
    }
  }

  function handleRemoveLabel(option: string) {
    let next: string[]

    try {
      next = removeLabelOption(labelOptions, option)
    } catch (caughtError) {
      setLabelError(
        caughtError instanceof Error ? caughtError.message : t.entryLogger.invalidLabel,
      )
      return
    }

    void saveLabelOptions(next)
  }

  async function save(rawValues: readonly (string | boolean)[]) {
    if (saving) {
      return
    }

    setError('')
    setConfirmation('')

    let localDateTime: string | null = null

    if (timeTouched) {
      localDateTime = combineDateAndTime(dateText, timeText)

      if (localDateTime === null) {
        setError(invalidDateTimeMessage())
        return
      }
    }

    if (rawValues.length === 0) {
      setError(t.entryLogger.chooseLabel)
      return
    }

    // One moment shared by all entries, so several labels logged together
    // have exactly the same time.
    const now = new Date()
    let builtEntries

    try {
      builtEntries = rawValues.map((rawValue) =>
        buildEntryInput(
          habit,
          { rawValue, localDateTime, timezone: timezone.trim(), comment },
          now,
        ),
      )
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : t.entryLogger.readFailed,
      )
      return
    }

    setSaving(true)

    const built = builtEntries[0]
    const inputs = builtEntries.map((item) => item.input)

    try {
      if (inputs.length === 1) {
        await onCreateEntry(built.input)
      } else if (onCreateEntries) {
        await onCreateEntries(inputs)
      } else {
        for (const input of inputs) {
          await onCreateEntry(input)
        }
      }

      const when = formatInTimezone(
        built.input.occurredStart ?? new Date().toISOString(),
        built.input.timezone ?? timezone,
        'd MMM, HH:mm',
      )

      const saved = t.entryLogger.saved(habit.type === 'label' ? rawValues.join(', ') : '', when)

      setConfirmation(built.ambiguousTime ? `${saved} ${t.entryLogger.timeTwice}` : saved)

      // Clear the typed value and comment. The chosen date/time and
      // timezone are kept, to make back-filling several entries easier.
      setTextValue('')
      setSelectedLabels([])
      setComment(commentTemplate())
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : t.entryLogger.saveFailed,
      )
    } finally {
      setSaving(false)
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void save([textValue])
  }

  /** Shows the current time in the given timezone in the fields. */
  function showCurrentTime(zone: string) {
    const safeZone = isValidTimezone(zone) ? zone : getDeviceTimezone()
    const { date, time } = splitLocalDateTime(
      utcToLocalDateTime(new Date().toISOString(), safeZone),
    )

    setDateText(date)
    setTimeText(time)
    setTimeTouched(false)
  }

  function toggleOptions() {
    if (!showOptions && !timeTouched) {
      showCurrentTime(timezone.trim())
    }
    setShowOptions(!showOptions)
  }

  function handleTimezoneChange(zone: string) {
    setTimezone(zone)

    if (!timeTouched && isValidTimezone(zone.trim())) {
      showCurrentTime(zone.trim())
    }
  }

  const buttonClass =
    'rounded-md px-3 py-2 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50'

  return (
    <div className="mt-4 rounded-lg bg-slate-50 p-4">
      {habit.type === 'checkbox' && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={saving}
            onClick={() => void save([true])}
            className={`${buttonClass} bg-blue-600 text-white hover:bg-blue-700`}
          >
            {t.entryLogger.done}
          </button>

          <button
            type="button"
            disabled={saving}
            onClick={() => void save([false])}
            className={`${buttonClass} border border-slate-300 bg-white hover:bg-slate-100`}
          >
            {t.entryLogger.notDone}
          </button>
        </div>
      )}

      {habit.type === 'label' && (
        <div>
          <div
            role="group"
            aria-label={t.entryLogger.labelsFor(habit.name)}
            className="flex flex-wrap gap-2"
          >
            {labelOptions.map((option) => {
              const chosen = chosenLabels.includes(option)

              return (
                <button
                  key={option}
                  type="button"
                  aria-pressed={chosen}
                  disabled={saving}
                  onClick={() =>
                    setSelectedLabels(
                      toggleLabelSelection(labelOptions, chosenLabels, option),
                    )
                  }
                  className={`${buttonClass} border ${
                    chosen
                      ? 'border-blue-500 bg-blue-600 text-white hover:bg-blue-700'
                      : 'border-slate-300 bg-white hover:bg-slate-100'
                  }`}
                >
                  {chosen ? `✓ ${option}` : option}
                </button>
              )
            })}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={saving || chosenLabels.length === 0}
              onClick={() => void save(chosenLabels)}
              className={`${buttonClass} bg-blue-600 text-white hover:bg-blue-700`}
            >
              {saving
                ? t.common.saving
                : chosenLabels.length > 1
                  ? t.entryLogger.logLabels(chosenLabels.length)
                  : t.entryLogger.log}
            </button>

            {chosenLabels.length > 0 && (
              <button
                type="button"
                disabled={saving}
                onClick={() => setSelectedLabels([])}
                className="text-xs font-medium text-slate-600 hover:underline"
              >
                {t.entryLogger.clearChoice}
              </button>
            )}

            {onUpdateLabelOptions && (
              <button
                type="button"
                aria-expanded={editingLabels}
                onClick={() => {
                  setEditingLabels(!editingLabels)
                  setLabelError('')
                }}
                className="text-xs font-medium text-blue-700 hover:underline"
              >
                {editingLabels ? t.entryLogger.doneEditingLabels : t.entryLogger.addOrRemoveLabels}
              </button>
            )}
          </div>

          {editingLabels && onUpdateLabelOptions && (
            <div className="mt-3 rounded-md border border-slate-200 bg-white p-3">
              <ul className="flex flex-wrap gap-2">
                {labelOptions.map((option) => (
                  <li
                    key={option}
                    className="flex items-center gap-1 rounded-md border border-slate-300 py-1 pl-2 pr-1 text-xs"
                  >
                    {option}
                    <button
                      type="button"
                      disabled={labelBusy || labelOptions.length === 1}
                      onClick={() => handleRemoveLabel(option)}
                      aria-label={t.entryLogger.removeLabel(option)}
                      className="rounded px-1 text-slate-500 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>

              <form
                onSubmit={(event) => void handleAddLabel(event)}
                className="mt-3 flex flex-wrap items-center gap-2"
              >
                <label htmlFor={`${id}-new-label`} className="sr-only">
                  {t.entryLogger.newLabelFor(habit.name)}
                </label>
                <input
                  id={`${id}-new-label`}
                  type="text"
                  autoComplete="off"
                  maxLength={50}
                  value={newLabel}
                  onChange={(event) => setNewLabel(event.target.value)}
                  placeholder={t.entryLogger.newLabel}
                  className="w-40 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
                <button
                  type="submit"
                  disabled={labelBusy}
                  className={`${buttonClass} border border-slate-300 bg-white hover:bg-slate-100`}
                >
                  {labelBusy ? t.common.saving : t.entryLogger.addLabel}
                </button>
              </form>

              <p className="mt-2 text-xs text-slate-500">
                {t.entryLogger.labelInUseHelp}
              </p>

              {labelError && (
                <p role="alert" className="mt-2 text-xs text-red-700">
                  {labelError}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {(habit.type === 'number' || habit.type === 'text') && (
        <form onSubmit={handleSubmit} className="flex flex-wrap items-start gap-2">
          <label htmlFor={`${id}-value`} className="sr-only">
            {habit.type === 'number' ? t.entryLogger.valueFor(habit.name) : t.entryLogger.textFor(habit.name)}
          </label>

          {habit.type === 'number' ? (
            <input
              id={`${id}-value`}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={textValue}
              onChange={(event) => setTextValue(event.target.value)}
              placeholder={t.entryLogger.valuePlaceholder(habit.unit)}
              className="w-36 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          ) : (
            <textarea
              id={`${id}-value`}
              rows={2}
              value={textValue}
              onChange={(event) => setTextValue(event.target.value)}
              placeholder={t.entryLogger.writeEntry}
              className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          )}

          <button
            type="submit"
            disabled={saving}
            className={`${buttonClass} bg-blue-600 text-white hover:bg-blue-700`}
          >
            {saving ? t.common.saving : t.entryLogger.log}
          </button>
        </form>
      )}

      <button
        type="button"
        onClick={toggleOptions}
        aria-expanded={showOptions}
        className="mt-3 text-xs font-medium text-blue-700 hover:underline"
      >
        {showOptions ? t.entryLogger.fewerOptions : t.entryLogger.moreOptions}
      </button>

      {showOptions && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <DateTime24Field
              id={`${id}-when`}
              label={t.entryLogger.dateAndTime}
              date={dateText}
              time={timeText}
              onDateChange={(value) => {
                setDateText(value)
                setTimeTouched(true)
              }}
              onTimeChange={(value) => {
                setTimeText(value)
                setTimeTouched(true)
              }}
            />

            <p className="mt-1 text-xs text-slate-500">
              {timeTouched ? (
                <button
                  type="button"
                  onClick={() => showCurrentTime(timezone.trim())}
                  className="text-blue-700 hover:underline"
                >
                  {t.entryLogger.useCurrentTime}
                </button>
              ) : (
                t.entryLogger.usesCurrentTime
              )}
            </p>
          </div>

          <TimezoneField
            id={`${id}-timezone`}
            value={timezone}
            onChange={handleTimezoneChange}
          />

          <div className="sm:col-span-2">
            <label
              htmlFor={`${id}-comment`}
              className="mb-1 block text-xs font-medium text-slate-600"
            >
              {t.common.commentOptional}
            </label>

            <textarea
              id={`${id}-comment`}
              rows={4}
              maxLength={2000}
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
            />
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-3 text-xs text-red-700">
          {error}
        </p>
      )}

      {confirmation && (
        <p role="status" className="mt-3 text-xs text-green-700">
          {confirmation}
        </p>
      )}
    </div>
  )
}
