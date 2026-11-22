import type {
  ActiveTimer,
  Contact,
  ContactInteraction,
  DataSource,
  Entry,
  ExternalSample,
  Habit,
  SettingRecord,
  SleepSession,
  SyncFields,
  SyncStatus,
} from '../../database/types'
import type { PlainRecord } from '../../database/upgrades'
import {
  MAX_COMMENT_LENGTH,
  validateEntryTimes,
  validateEntryValue,
  validateHabitDefinition,
  validateMetadata,
  validateSleepStages,
  validateSleepTimes,
  validateStopwatchValue,
  validateTimezone,
  validateUtcOffsetMinutes,
} from '../../database/validation'
import { buildSleepDedupeKey } from '../../database/sleepSessions'
import { isLocationType, validateLocationSample } from '../../location/location'
import { validateScreenTimeSample } from '../../screenTime/screenTime'
import { isHealthMeasurement, validateHealthSample } from '../../healthData/healthData'
import { validateYnabSample, YNAB_MEASUREMENT } from '../../ynab/ynabRecord'
import {
  DISPLAY_TIMEZONE_KEY,
  isValidDisplayTimezone,
} from '../../settings/displayTimezone'
import { isValidSleepTargetValue } from '../../settings/sleepTargets'
import { DASHBOARD_METRICS_KEY, parseMetricSelection } from '../../settings/dashboardMetrics'
import { DASHBOARD_ORDER_KEY, parseSectionOrder } from '../../settings/dashboardOrder'
import { DASHBOARD_HIDDEN_KEY, parseHiddenSections } from '../../settings/dashboardHidden'
import { DASHBOARD_SCREEN_TIME_APPS_KEY, parseChosenApps } from '../../settings/dashboardScreenTimeApps'
import { DASHBOARD_YNAB_CATEGORIES_KEY, parseChosenCategories } from '../../settings/dashboardYnabCategories'
import { GOALS_LIST_KEY, GOALS_PROFILE_KEY, parseGoals, parseProfile } from '../../goals/goals'
import {
  DASHBOARD_AWAY_PLACE_KEY,
  DASHBOARD_LOCATION_KEY,
  isValidPlaceKey,
  parsePlaceNames,
  PLACE_NAMES_KEY,
} from '../../settings/dashboardLocation'
import { isLocationMeasure } from '../../location/dailyLocation'
import { FORMULAS_KEY, parseFormulaList } from '../../formulas/formulas'
import {
  CONTACT_FIELD_LABELS,
  normalizeBirthday,
  normalizeContactName,
  normalizeContactText,
  normalizeExternalPhoneId,
  normalizeInteractionText,
} from '../../crm/contactFields'

/**
 * Validates records read from a backup with the same rules the app uses
 * when writing data. Each function returns a clean record (only known
 * fields) or throws an Error whose message explains the problem.
 */

const STORED_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const SYNC_STATUSES: SyncStatus[] = ['pending', 'synced', 'conflict']
const SOURCES: DataSource[] = ['manual', 'health_connect', 'import']
/** Imported samples can also come from the phone (screen time). */
const SAMPLE_SOURCES: DataSource[] = [...SOURCES, 'android_usage', 'ynab']

function requireId(value: unknown, field = 'id'): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 200) {
    throw new Error(`missing or invalid ${field}`)
  }
  return value
}

function requireTimestamp(value: unknown, field: string): string {
  if (
    typeof value !== 'string' ||
    !STORED_TIMESTAMP.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    throw new Error(`invalid ${field}`)
  }
  return value
}

function requireNullableTimestamp(value: unknown, field: string): string | null {
  return value === null ? null : requireTimestamp(value, field)
}

function requireSyncFields(record: PlainRecord): SyncFields {
  const { syncStatus, revision, syncedRevision } = record

  if (!SYNC_STATUSES.includes(syncStatus as SyncStatus)) {
    throw new Error('invalid sync status')
  }

  if (typeof revision !== 'number' || !Number.isInteger(revision) || revision < 1) {
    throw new Error('invalid revision')
  }

  if (
    syncedRevision !== null &&
    (typeof syncedRevision !== 'number' ||
      !Number.isInteger(syncedRevision) ||
      syncedRevision < 1 ||
      syncedRevision > revision)
  ) {
    throw new Error('invalid synced revision')
  }

  return { syncStatus: syncStatus as SyncStatus, revision, syncedRevision }
}

function messageOf(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  // Lower-case first letter so it reads well after "Habit …: ".
  return text.charAt(0).toLowerCase() + text.slice(1).replace(/\.$/, '')
}

/** Runs a validation and turns any error into a short reason. */
function check<T>(validate: () => T): T {
  try {
    return validate()
  } catch (caughtError) {
    throw new Error(messageOf(caughtError))
  }
}

export interface ValidatedHabit {
  habit: Habit
  /** Harmless corrections applied (e.g. a unit on a non-number habit). */
  notes: string[]
}

export function validateHabitRecord(raw: PlainRecord): ValidatedHabit {
  return check(() => {
    const definition = validateHabitDefinition({
      name: raw.name as string,
      type: raw.type as Habit['type'],
      unit: raw.unit as string | null,
      labelOptions: raw.labelOptions as string[] | null,
      color: raw.color as string,
      dailyAggregation: raw.dailyAggregation as 'sum' | 'mean' | undefined,
      target: raw.target as number | null | undefined,
    })

    if (typeof raw.archived !== 'boolean') {
      throw new Error('invalid archived flag')
    }

    if (typeof raw.sortOrder !== 'number' || !Number.isFinite(raw.sortOrder)) {
      throw new Error('invalid sort order')
    }

    const notes: string[] = []

    if ((raw.unit ?? null) !== definition.unit) {
      notes.push(
        definition.unit === null
          ? `Habit "${definition.name}": unit "${String(raw.unit)}" removed (only number habits have units).`
          : `Habit "${definition.name}": unit changed to "${definition.unit}" (spaces removed).`,
      )
    }

    if (raw.name !== definition.name) {
      notes.push(`Habit "${definition.name}": spaces around the name removed.`)
    }

    const habit = {
      id: requireId(raw.id),
      ...definition,
      archived: raw.archived,
      sortOrder: raw.sortOrder,
      ...requireSyncFields(raw),
      createdAt: requireTimestamp(raw.createdAt, 'creation time'),
      updatedAt: requireTimestamp(raw.updatedAt, 'update time'),
      deletedAt: requireNullableTimestamp(raw.deletedAt, 'deletion time'),
    } as Habit

    return { habit, notes }
  })
}

export function validateEntryRecord(raw: PlainRecord, habit: Habit | undefined): Entry {
  return check(() => {
    if (!habit) {
      throw new Error('its habit is neither in the backup nor on this device')
    }

    if (raw.habitType !== habit.type) {
      throw new Error(`its type (${String(raw.habitType)}) does not match its habit (${habit.type})`)
    }

    const value = validateEntryValue(habit, raw.value)
    const occurredStart = requireTimestamp(raw.occurredStart, 'start time')
    const occurredEnd = requireNullableTimestamp(raw.occurredEnd, 'end time')

    validateEntryTimes(habit.type, occurredStart, occurredEnd, value)

    const comment = raw.comment

    if (comment !== null && (typeof comment !== 'string' || comment.length > MAX_COMMENT_LENGTH)) {
      throw new Error(`comment must be text of at most ${MAX_COMMENT_LENGTH} characters`)
    }

    if (!SOURCES.includes(raw.source as DataSource)) {
      throw new Error('invalid source')
    }

    if (raw.externalId !== null && typeof raw.externalId !== 'string') {
      throw new Error('invalid external id')
    }

    return {
      id: requireId(raw.id),
      habitId: habit.id,
      habitType: habit.type,
      occurredStart,
      occurredEnd,
      timezone: validateTimezone(raw.timezone as string),
      value,
      comment,
      source: raw.source as DataSource,
      externalId: raw.externalId,
      ...requireSyncFields(raw),
      createdAt: requireTimestamp(raw.createdAt, 'creation time'),
      updatedAt: requireTimestamp(raw.updatedAt, 'update time'),
      deletedAt: requireNullableTimestamp(raw.deletedAt, 'deletion time'),
    } as Entry
  })
}

export function validateTimerRecord(raw: PlainRecord, habit: Habit | undefined): ActiveTimer {
  return check(() => {
    if (!habit) {
      throw new Error('its habit is neither in the backup nor on this device')
    }

    if (habit.type !== 'stopwatch') {
      throw new Error('its habit is not a stopwatch habit')
    }

    const completedSegments = raw.completedSegments

    if (!Array.isArray(completedSegments)) {
      throw new Error('invalid completed periods')
    }

    const segments = completedSegments.length > 0
      ? validateStopwatchValue({ segments: completedSegments }).segments
      : []

    const comment = raw.comment

    if (comment !== null && (typeof comment !== 'string' || comment.length > MAX_COMMENT_LENGTH)) {
      throw new Error(`comment must be text of at most ${MAX_COMMENT_LENGTH} characters`)
    }

    return {
      habitId: habit.id,
      startedAt: requireTimestamp(raw.startedAt, 'start time'),
      timezone: validateTimezone(raw.timezone as string),
      comment,
      completedSegments: segments,
      runningSince: requireNullableTimestamp(raw.runningSince, 'running time'),
      createdAt: requireTimestamp(raw.createdAt, 'creation time'),
      updatedAt: requireTimestamp(raw.updatedAt, 'update time'),
    }
  })
}

export function validateSettingRecord(raw: PlainRecord): SettingRecord {
  return check(() => {
    const key = requireId(raw.key, 'key')

    if (typeof raw.value !== 'string' || raw.value.length > 100_000) {
      throw new Error('invalid value')
    }

    if (key === DISPLAY_TIMEZONE_KEY && !isValidDisplayTimezone(raw.value)) {
      throw new Error(`unknown display timezone "${raw.value}"`)
    }

    if (key === DASHBOARD_METRICS_KEY && parseMetricSelection(raw.value) === null) {
      throw new Error('invalid dashboard metric selection')
    }

    if (key === DASHBOARD_ORDER_KEY && parseSectionOrder(raw.value) === null) {
      throw new Error('invalid dashboard section order')
    }

    if (key === DASHBOARD_HIDDEN_KEY && parseHiddenSections(raw.value) === null) {
      throw new Error('invalid list of hidden dashboard panels')
    }

    if (key === DASHBOARD_SCREEN_TIME_APPS_KEY && parseChosenApps(raw.value) === null) {
      throw new Error('invalid list of screen-time apps')
    }

    if (key === DASHBOARD_YNAB_CATEGORIES_KEY && parseChosenCategories(raw.value) === null) {
      throw new Error('invalid list of spending categories')
    }

    if (key === GOALS_PROFILE_KEY && parseProfile(raw.value) === null) {
      throw new Error('invalid AI profile')
    }

    if (key === GOALS_LIST_KEY && parseGoals(raw.value) === null) {
      throw new Error('invalid list of goals')
    }

    if (key === DASHBOARD_LOCATION_KEY && !isLocationMeasure(raw.value)) {
      throw new Error(`unknown location view "${raw.value}"`)
    }

    if (key === DASHBOARD_AWAY_PLACE_KEY && !isValidPlaceKey(raw.value)) {
      throw new Error('invalid place for "time away from"')
    }

    if (key === PLACE_NAMES_KEY && parsePlaceNames(raw.value) === null) {
      throw new Error('invalid place names')
    }

    if (key === FORMULAS_KEY && parseFormulaList(raw.value) === null) {
      throw new Error('invalid formulas')
    }

    if (!isValidSleepTargetValue(key, raw.value)) {
      throw new Error(`invalid target value "${raw.value}"`)
    }

    return {
      key,
      value: raw.value,
      updatedAt: requireTimestamp(raw.updatedAt, 'update time'),
      deletedAt: requireNullableTimestamp(raw.deletedAt, 'deletion time'),
      ...requireSyncFields(raw),
    }
  })
}

function requireNullableText(value: unknown, field: string, maxLength: number): string | null {
  if (value === null) {
    return null
  }

  if (typeof value !== 'string' || value.length > maxLength) {
    throw new Error(`invalid ${field}`)
  }

  return value
}

export function validateSleepSessionRecord(raw: PlainRecord): SleepSession {
  return check(() => {
    const id = requireId(raw.id)

    if (!SOURCES.includes(raw.source as DataSource)) {
      throw new Error('invalid source')
    }

    const source = raw.source as DataSource
    const externalId = requireNullableText(raw.externalId, 'external id', 500)
    const startUtc = requireTimestamp(raw.startUtc, 'bedtime')
    const endUtc = requireTimestamp(raw.endUtc, 'wake time')

    validateSleepTimes(startUtc, endUtc)

    const timezone = raw.timezone === null ? null : validateTimezone(raw.timezone as string)
    const startOffsetMinutes = validateUtcOffsetMinutes(raw.startOffsetMinutes)

    if (timezone === null && startOffsetMinutes === null) {
      throw new Error('it has neither a timezone nor a UTC offset')
    }

    const expectedKey = buildSleepDedupeKey({ source, id, externalId, startUtc, endUtc })

    if (raw.dedupeKey !== expectedKey) {
      throw new Error('its duplicate-detection key does not match its data')
    }

    const reportedSleepMs = raw.reportedSleepMs

    if (
      reportedSleepMs !== null &&
      (typeof reportedSleepMs !== 'number' || !Number.isFinite(reportedSleepMs))
    ) {
      throw new Error('invalid reported sleep duration')
    }

    return {
      id,
      source,
      externalId,
      sourceApp: requireNullableText(raw.sourceApp, 'source app', 200),
      dedupeKey: expectedKey,
      startUtc,
      endUtc,
      timezone,
      startOffsetMinutes,
      endOffsetMinutes: validateUtcOffsetMinutes(raw.endOffsetMinutes),
      stages: validateSleepStages(raw.stages),
      reportedSleepMs,
      comment: requireNullableText(raw.comment, 'comment', MAX_COMMENT_LENGTH),
      importedAt: requireNullableTimestamp(raw.importedAt, 'import time'),
      metadata: validateMetadata(raw.metadata),
      ...requireSyncFields(raw),
      createdAt: requireTimestamp(raw.createdAt, 'creation time'),
      updatedAt: requireTimestamp(raw.updatedAt, 'update time'),
      deletedAt: requireNullableTimestamp(raw.deletedAt, 'deletion time'),
    }
  })
}

/**
 * Imported samples: daily screen time and location visits / movements
 * (docs/PHASE5_PLAN.md §3, §7). Any other kind is rejected (reported,
 * never dropped) until the app knows how to check it.
 */
export function validateExternalSampleRecord(raw: PlainRecord): ExternalSample {
  return check(() => {
    if (!SAMPLE_SOURCES.includes(raw.source as DataSource)) {
      throw new Error('invalid source')
    }

    if (typeof raw.measurementType !== 'string') {
      throw new Error('invalid kind of imported sample')
    }

    if (typeof raw.value !== 'number' || !Number.isFinite(raw.value)) {
      throw new Error('invalid value')
    }

    const sample: ExternalSample = {
      id: requireId(raw.id),
      source: raw.source as DataSource,
      externalId: requireNullableText(raw.externalId, 'external id', 500),
      sourceApp: requireNullableText(raw.sourceApp, 'source app', 200),
      dedupeKey: requireId(raw.dedupeKey, 'duplicate-detection key'),
      measurementType: raw.measurementType,
      value: raw.value,
      unit: requireNullableText(raw.unit, 'unit', 50),
      startUtc: requireTimestamp(raw.startUtc, 'start time'),
      endUtc: requireNullableTimestamp(raw.endUtc, 'end time'),
      timezone: raw.timezone === null ? null : validateTimezone(raw.timezone as string),
      startOffsetMinutes: validateUtcOffsetMinutes(raw.startOffsetMinutes),
      importedAt: requireTimestamp(raw.importedAt, 'import time'),
      metadata: validateMetadata(raw.metadata),
      ...requireSyncFields(raw),
      createdAt: requireTimestamp(raw.createdAt, 'creation time'),
      updatedAt: requireTimestamp(raw.updatedAt, 'update time'),
      deletedAt: requireNullableTimestamp(raw.deletedAt, 'deletion time'),
    }

    if (isLocationType(sample.measurementType)) validateLocationSample(sample)
    else if (isHealthMeasurement(sample.measurementType)) validateHealthSample(sample)
    else if (sample.measurementType === YNAB_MEASUREMENT) validateYnabSample(sample)
    else validateScreenTimeSample(sample)

    return sample
  })
}

/**
 * A stored text field must already be in its saved form (trimmed, empty
 * stored as null): anything else is reported, never silently changed.
 */
function requireStoredText(value: unknown, normalize: (value: unknown) => string | null, field: string): string | null {
  const normalized = normalize(value)
  if (normalized !== value) throw new Error(`${field} is not stored in the expected form`)
  return normalized
}

export function validateContactRecord(raw: PlainRecord): Contact {
  return check(() => {
    const text = (value: unknown, field: keyof typeof CONTACT_FIELD_LABELS) =>
      requireStoredText(value, (v) => normalizeContactText(v, CONTACT_FIELD_LABELS[field]), CONTACT_FIELD_LABELS[field])

    return {
      id: requireId(raw.id),
      name: requireStoredText(raw.name, normalizeContactName, 'name') as string,
      description: text(raw.description, 'description'),
      education: text(raw.education, 'education'),
      address: text(raw.address, 'address'),
      birthday: requireStoredText(raw.birthday, normalizeBirthday, 'birthday'),
      interests: text(raw.interests, 'interests'),
      dislikes: text(raw.dislikes, 'dislikes'),
      externalPhoneId: normalizeExternalPhoneId(raw.externalPhoneId),
      ...requireSyncFields(raw),
      createdAt: requireTimestamp(raw.createdAt, 'creation time'),
      updatedAt: requireTimestamp(raw.updatedAt, 'update time'),
      deletedAt: requireNullableTimestamp(raw.deletedAt, 'deletion time'),
    }
  })
}

export function validateContactInteractionRecord(raw: PlainRecord, contact: Contact | undefined): ContactInteraction {
  return check(() => {
    if (!contact) {
      throw new Error('its contact is neither in the backup nor on this device')
    }

    return {
      id: requireId(raw.id),
      contactId: contact.id,
      occurredStart: requireTimestamp(raw.occurredStart, 'time'),
      timezone: validateTimezone(raw.timezone as string),
      text: requireStoredText(raw.text, normalizeInteractionText, 'text') as string,
      ...requireSyncFields(raw),
      createdAt: requireTimestamp(raw.createdAt, 'creation time'),
      updatedAt: requireTimestamp(raw.updatedAt, 'update time'),
      deletedAt: requireNullableTimestamp(raw.deletedAt, 'deletion time'),
    }
  })
}
