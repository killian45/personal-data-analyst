import { messages } from '../i18n'
import { isValidTimezone } from '../time/time'
import { HABIT_TYPES, SLEEP_STAGE_TYPES } from './types'

import type {
  EntryValue,
  Habit,
  HabitDefinition,
  HabitType,
  SleepStage,
  SleepStageType,
  StopwatchValue,
} from './types'

/**
 * Shared validation rules for all data written to the database.
 *
 * Every function either returns a normalised value or throws an Error
 * with a message that can be shown to the user.
 */

export const DEFAULT_HABIT_COLOR = '#2563eb'

export const MAX_HABIT_NAME_LENGTH = 80
export const MAX_UNIT_LENGTH = 20
export const MAX_LABEL_OPTION_LENGTH = 50
export const MAX_COMMENT_LENGTH = 2000
export const MAX_TEXT_LENGTH = 10000
export const MAX_STOPWATCH_SEGMENTS = 1000

/** Longest accepted sleep session: longer sessions are data errors. */
export const MAX_SLEEP_SESSION_MS = 48 * 60 * 60 * 1000
export const MAX_SLEEP_STAGES = 5000
/** UTC offsets range from −18:00 to +18:00. */
export const MAX_UTC_OFFSET_MINUTES = 18 * 60

const ISO_TIMESTAMP_WITH_OFFSET =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/

// ---------------------------------------------------------------------------
// Habits
// ---------------------------------------------------------------------------

export function isHabitType(value: unknown): value is HabitType {
  return (
    typeof value === 'string' &&
    (HABIT_TYPES as readonly string[]).includes(value)
  )
}

export interface HabitDefinitionInput {
  name: string
  type: HabitType
  unit?: string | null
  labelOptions?: string[] | null
  color?: string
  /** Number habits only; default "sum". */
  dailyAggregation?: 'sum' | 'mean'
  /** Number habits only; null or omitted = no target. */
  target?: number | null
}

function normalizeLabelOptions(
  labelOptions: string[] | null | undefined,
): string[] {
  if (!Array.isArray(labelOptions) || labelOptions.length === 0) {
    throw new Error(messages().validation.labelOptionRequired)
  }

  if (labelOptions.some((option) => typeof option !== 'string')) {
    throw new Error(messages().validation.labelOptionsText)
  }

  const options = labelOptions.map((option) => option.trim())

  if (options.some((option) => option.length === 0)) {
    throw new Error(messages().validation.labelOptionEmpty)
  }

  if (options.some((option) => option.length > MAX_LABEL_OPTION_LENGTH)) {
    throw new Error(
      messages().validation.labelOptionTooLong(MAX_LABEL_OPTION_LENGTH),
    )
  }

  const uniqueOptions = new Set(
    options.map((option) => option.toLocaleLowerCase()),
  )

  if (uniqueOptions.size !== options.length) {
    throw new Error(messages().validation.labelOptionsUnique)
  }

  return options
}

/**
 * Validates and normalises the user-defined fields of a habit.
 *
 * - The name is trimmed and must be 1–80 characters.
 * - The color must be a six-digit hexadecimal color.
 * - Only number habits keep a unit (trimmed, max 20 characters);
 *   other types always store null.
 * - Only label habits keep label options (trimmed, non-empty,
 *   max 50 characters, unique ignoring case); other types store null.
 * - Only number habits have a daily aggregation ("sum" by default, or
 *   "mean") and an optional target (a finite number or null).
 */
export function validateHabitDefinition(
  input: HabitDefinitionInput,
): HabitDefinition {
  if (typeof input.name !== 'string') {
    throw new Error(messages().validation.habitNameText)
  }

  const name = input.name.trim()

  if (name.length === 0) {
    throw new Error(messages().validation.habitNameEmpty)
  }

  if (name.length > MAX_HABIT_NAME_LENGTH) {
    throw new Error(
      messages().validation.habitNameTooLong(MAX_HABIT_NAME_LENGTH),
    )
  }

  if (!isHabitType(input.type)) {
    throw new Error(messages().validation.habitType)
  }

  const color = input.color ?? DEFAULT_HABIT_COLOR

  if (typeof color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(color)) {
    throw new Error(messages().validation.color)
  }

  switch (input.type) {
    case 'number': {
      const unit = input.unit?.trim() || null

      if (unit !== null && unit.length > MAX_UNIT_LENGTH) {
        throw new Error(
          messages().validation.unitTooLong(MAX_UNIT_LENGTH),
        )
      }

      const dailyAggregation = input.dailyAggregation ?? 'sum'

      if (dailyAggregation !== 'sum' && dailyAggregation !== 'mean') {
        throw new Error(messages().validation.dailyValue)
      }

      const target = input.target ?? null

      if (target !== null && (typeof target !== 'number' || !Number.isFinite(target))) {
        throw new Error(messages().validation.targetNumber)
      }

      return {
        name,
        color,
        type: 'number',
        unit,
        labelOptions: null,
        dailyAggregation,
        target,
      }
    }

    case 'label':
      return {
        name,
        color,
        type: 'label',
        unit: null,
        labelOptions: normalizeLabelOptions(input.labelOptions),
      }

    case 'stopwatch':
    case 'checkbox':
    case 'text':
      return { name, color, type: input.type, unit: null, labelOptions: null }
  }
}

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

/**
 * Accepts an ISO 8601 date-time that includes seconds and an explicit
 * offset (Z or ±hh:mm), and returns it as a UTC ISO string.
 *
 * Strings without an offset are rejected, because their meaning would
 * depend on the browser's timezone.
 */
export function normalizeTimestamp(value: string): string {
  if (
    typeof value !== 'string' ||
    !ISO_TIMESTAMP_WITH_OFFSET.test(value)
  ) {
    throw new Error(
      messages().validation.timestampFormat,
    )
  }

  const timestamp = Date.parse(value)

  if (!Number.isFinite(timestamp)) {
    throw new Error(messages().validation.timestamp)
  }

  return new Date(timestamp).toISOString()
}

/**
 * Accepts a valid IANA timezone name such as "Europe/Paris".
 */
export function validateTimezone(timezone: string): string {
  if (typeof timezone !== 'string' || timezone.trim().length === 0) {
    throw new Error(messages().validation.timezoneEmpty)
  }

  if (!isValidTimezone(timezone)) {
    throw new Error(messages().validation.timezone)
  }

  return timezone
}

// ---------------------------------------------------------------------------
// Entries
// ---------------------------------------------------------------------------

/**
 * Trims a comment. Empty comments become null. Max 2,000 characters.
 */
export function normalizeComment(
  comment: string | null | undefined,
): string | null {
  if (comment === undefined || comment === null) {
    return null
  }

  if (typeof comment !== 'string') {
    throw new Error(messages().validation.commentText)
  }

  const normalized = comment.trim()

  if (normalized.length > MAX_COMMENT_LENGTH) {
    throw new Error(
      messages().validation.commentTooLong(MAX_COMMENT_LENGTH),
    )
  }

  return normalized || null
}

/**
 * Validates stopwatch periods and returns them with UTC timestamps.
 *
 * Rules:
 * - At least one period, at most 1,000.
 * - Each period ends strictly after it starts.
 * - Periods are in time order and do not overlap. A period may start
 *   exactly when the previous one ended (a zero-length pause).
 */
export function validateStopwatchValue(value: unknown): StopwatchValue {
  if (
    typeof value !== 'object' ||
    value === null ||
    !Array.isArray((value as { segments?: unknown }).segments)
  ) {
    throw new Error(messages().validation.periodsList)
  }

  const rawSegments = (value as { segments: unknown[] }).segments

  if (rawSegments.length === 0) {
    throw new Error(messages().validation.periodsRequired)
  }

  if (rawSegments.length > MAX_STOPWATCH_SEGMENTS) {
    throw new Error(
      messages().validation.periodsTooMany(MAX_STOPWATCH_SEGMENTS),
    )
  }

  const segments = rawSegments.map((segment) => {
    if (typeof segment !== 'object' || segment === null) {
      throw new Error(messages().validation.periodStartEnd)
    }

    const { start, end } = segment as { start?: unknown; end?: unknown }

    if (typeof start !== 'string' || typeof end !== 'string') {
      throw new Error(messages().validation.periodStartEnd)
    }

    const normalized = {
      start: normalizeTimestamp(start),
      end: normalizeTimestamp(end),
    }

    if (Date.parse(normalized.end) <= Date.parse(normalized.start)) {
      throw new Error(messages().validation.stopwatchEndAfterStart)
    }

    return normalized
  })

  for (let index = 1; index < segments.length; index += 1) {
    if (
      Date.parse(segments[index].start) <
      Date.parse(segments[index - 1].end)
    ) {
      throw new Error(
        messages().validation.periodsOrder,
      )
    }
  }

  return { segments }
}

/**
 * Checks that an entry value matches its habit type:
 *
 * - number: finite number (NaN and Infinity are rejected)
 * - checkbox: boolean
 * - label: one of the habit's label options (exact match)
 * - text: string of at most 10,000 characters
 * - stopwatch: valid active periods (see validateStopwatchValue)
 */
export function validateEntryValue(
  habit: Habit,
  value: unknown,
): EntryValue {
  switch (habit.type) {
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(messages().validation.numberValue)
      }
      return value

    case 'checkbox':
      if (typeof value !== 'boolean') {
        throw new Error(messages().validation.checkboxValue)
      }
      return value

    case 'label':
      if (
        typeof value !== 'string' ||
        !habit.labelOptions.includes(value)
      ) {
        throw new Error(
          messages().validation.labelValue,
        )
      }
      return value

    case 'text':
      if (typeof value !== 'string') {
        throw new Error(messages().validation.textValue)
      }

      if (value.length > MAX_TEXT_LENGTH) {
        throw new Error(
          messages().validation.textTooLong(MAX_TEXT_LENGTH),
        )
      }

      return value

    case 'stopwatch':
      return validateStopwatchValue(value)

    default:
      throw new Error(messages().validation.unsupportedType)
  }
}

/**
 * Stopwatch entries require an end strictly after their start, and
 * their start/end must equal the start of the first period and the end
 * of the last period.
 * Other entry types are instantaneous and must not have an end.
 *
 * Timestamps must already be normalised UTC strings, and a stopwatch
 * value must already be validated.
 */
export function validateEntryTimes(
  habitType: HabitType,
  occurredStart: string,
  occurredEnd: string | null,
  value?: EntryValue,
): void {
  if (habitType === 'stopwatch') {
    if (occurredEnd === null) {
      throw new Error(messages().validation.stopwatchEnd)
    }

    if (Date.parse(occurredEnd) <= Date.parse(occurredStart)) {
      throw new Error(messages().validation.stopwatchEndAfterStart)
    }

    if (value !== undefined) {
      const { segments } = value as StopwatchValue

      if (
        segments[0].start !== occurredStart ||
        segments[segments.length - 1].end !== occurredEnd
      ) {
        throw new Error(
          messages().validation.stopwatchMatchPeriods,
        )
      }
    }

    return
  }

  if (occurredEnd !== null) {
    throw new Error(
      messages().validation.onlyStopwatchEnd,
    )
  }
}

// ---------------------------------------------------------------------------
// Sleep
// ---------------------------------------------------------------------------

/**
 * A sleep session must end after it starts and last at most 48 hours.
 * Both timestamps must already be normalised UTC strings.
 */
export function validateSleepTimes(startUtc: string, endUtc: string): void {
  const durationMs = Date.parse(endUtc) - Date.parse(startUtc)

  if (durationMs <= 0) {
    throw new Error(messages().validation.wakeAfterBed)
  }

  if (durationMs > MAX_SLEEP_SESSION_MS) {
    throw new Error(messages().validation.sleepTooLong)
  }
}

/** A UTC offset in whole minutes between −18:00 and +18:00, or null. */
export function validateUtcOffsetMinutes(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null
  }

  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    Math.abs(value) > MAX_UTC_OFFSET_MINUTES
  ) {
    throw new Error(messages().validation.utcOffset)
  }

  return value
}

/**
 * Checks the structure of sleep stages (timestamps and stage types).
 *
 * Intervals are kept as reported: overlapping stages, stages outside the
 * session or with an end before their start are NOT rejected here. The
 * sleep engine decides how to treat them, so original data is preserved.
 */
export function validateSleepStages(value: unknown): SleepStage[] {
  if (value === undefined || value === null) {
    return []
  }

  if (!Array.isArray(value)) {
    throw new Error(messages().validation.stagesList)
  }

  if (value.length > MAX_SLEEP_STAGES) {
    throw new Error(messages().validation.stagesTooMany(MAX_SLEEP_STAGES))
  }

  return value.map((stage) => {
    if (typeof stage !== 'object' || stage === null) {
      throw new Error(messages().validation.stageFields)
    }

    const { start, end, stage: type } = stage as Record<string, unknown>

    if (typeof start !== 'string' || typeof end !== 'string') {
      throw new Error(messages().validation.stageFields)
    }

    if (!(SLEEP_STAGE_TYPES as readonly string[]).includes(type as string)) {
      throw new Error(messages().validation.stageType(String(type)))
    }

    return {
      start: normalizeTimestamp(start),
      end: normalizeTimestamp(end),
      stage: type as SleepStageType,
    }
  })
}

/** Original source metadata: a plain JSON object, or null. */
export function validateMetadata(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) {
    return null
  }

  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(messages().validation.metadataObject)
  }

  try {
    JSON.stringify(value)
  } catch {
    throw new Error(messages().validation.metadataPlain)
  }

  return value as Record<string, unknown>
}
