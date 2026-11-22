/**
 * All supported habit types.
 * Single source of truth for runtime checks and TypeScript types.
 */
export const HABIT_TYPES = [
  'stopwatch',
  'number',
  'checkbox',
  'label',
  'text',
] as const

export type HabitType = (typeof HABIT_TYPES)[number]

export type DataSource =
  | 'manual'
  | 'health_connect'
  | 'import'
  /** Read on the phone through Android's "Usage access" (screen time). */
  | 'android_usage'
  /** Fetched from the user's YNAB budget (docs/YNAB_PLAN.md). */
  | 'ynab'

/**
 * One period during which a stopwatch was actually running.
 * Both instants are UTC ISO strings and end is after start.
 */
export interface StopwatchSegment {
  start: string
  end: string
}

/**
 * The value of a stopwatch entry: its active periods, in time order,
 * without overlaps. Gaps between periods are pauses and do not count
 * towards the active duration.
 */
export interface StopwatchValue {
  segments: StopwatchSegment[]
}

/**
 * The value stored in an entry, for each habit type.
 */
export interface EntryValueByHabitType {
  stopwatch: StopwatchValue
  number: number
  checkbox: boolean
  label: string
  text: string
}

export type EntryValue = EntryValueByHabitType[HabitType]

export interface BaseRecord {
  id: string
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

/**
 * Synchronisation state of a record (prepared for Phase 3).
 *
 * - pending:  changed locally and not yet confirmed by the cloud.
 * - synced:   confirmed by the cloud (set only by the future sync engine).
 * - conflict: the cloud holds a different change (set only by the
 *             future sync engine; never resolved silently).
 */
export type SyncStatus = 'pending' | 'synced' | 'conflict'

export interface SyncFields {
  /**
   * Every local change sets this back to "pending" (a record in
   * "conflict" stays in conflict until the user resolves it).
   */
  syncStatus: SyncStatus

  /**
   * Starts at 1 and increases by 1 with every local change.
   * Used to detect conflicting changes during synchronisation.
   */
  revision: number

  /**
   * The server revision this device last agreed on (schema version 8).
   * null before the record was first synchronised. Never higher than
   * revision. Set only by the sync engine; local edits keep it unchanged.
   */
  syncedRevision: number | null
}

interface HabitCommon extends BaseRecord, SyncFields {
  name: string
  color: string
  archived: boolean
  sortOrder: number
}

/**
 * Habits are a discriminated union on "type".
 *
 * - Only number habits have a unit.
 * - Only label habits have label options.
 *
 * Checking habit.type lets TypeScript know which other fields exist,
 * e.g. inside "if (habit.type === 'label')", labelOptions is string[].
 */
export interface StopwatchHabit extends HabitCommon {
  type: 'stopwatch'
  unit: null
  labelOptions: null
}

/**
 * How several entries of a number habit on the same day are combined:
 * "sum" (e.g. water 500 + 750 ml) or "mean" (e.g. weight measured twice).
 */
export type DailyAggregation = 'sum' | 'mean'

export interface NumberHabit extends HabitCommon {
  type: 'number'
  unit: string | null
  labelOptions: null
  /** Daily value: total (default) or average of the day's entries. */
  dailyAggregation: DailyAggregation
  /** Optional personal target for the daily value (same unit). */
  target: number | null
}

export interface CheckboxHabit extends HabitCommon {
  type: 'checkbox'
  unit: null
  labelOptions: null
}

export interface LabelHabit extends HabitCommon {
  type: 'label'
  unit: null
  labelOptions: string[]
}

export interface TextHabit extends HabitCommon {
  type: 'text'
  unit: null
  labelOptions: null
}

export type Habit =
  | StopwatchHabit
  | NumberHabit
  | CheckboxHabit
  | LabelHabit
  | TextHabit

/**
 * The user-defined part of a habit, kept as a discriminated union: every
 * field except identity, timestamps, archive/order and sync fields.
 */
export type HabitDefinition = Habit extends infer H
  ? H extends Habit
    ? Omit<H, keyof BaseRecord | keyof SyncFields | 'archived' | 'sortOrder'>
    : never
  : never

interface EntryCommon extends BaseRecord, SyncFields {
  habitId: string
  occurredStart: string
  timezone: string
  comment: string | null
  source: DataSource

  /** Identifier in the source system (e.g. Health Connect), if any. */
  externalId: string | null
}

/**
 * An entry for one habit type.
 *
 * - habitType copies the habit's type, so an entry describes itself.
 * - Stopwatch entries always have an end (the end of their last
 *   period); other entries are instantaneous and have no end.
 */
type EntryOf<T extends HabitType> = EntryCommon & {
  habitType: T
  value: EntryValueByHabitType[T]
  occurredEnd: T extends 'stopwatch' ? string : null
}

export type StopwatchEntry = EntryOf<'stopwatch'>
export type NumberEntry = EntryOf<'number'>
export type CheckboxEntry = EntryOf<'checkbox'>
export type LabelEntry = EntryOf<'label'>
export type TextEntry = EntryOf<'text'>

/**
 * Entries are a discriminated union on "habitType".
 */
export type Entry =
  | StopwatchEntry
  | NumberEntry
  | CheckboxEntry
  | LabelEntry
  | TextEntry

/**
 * A stopwatch that has been started and not yet stopped or cancelled.
 *
 * habitId is the primary key in IndexedDB:
 * only one active timer can exist per habit.
 *
 * Active time = all completedSegments + (now − runningSince) when running.
 */
export interface ActiveTimer {
  habitId: string

  /** Start of the first active period. */
  startedAt: string

  timezone: string
  comment: string | null

  /** Active periods that ended with a pause. */
  completedSegments: StopwatchSegment[]

  /** Start of the current active period, or null while paused. */
  runningSince: string | null

  createdAt: string
  updatedAt: string
}

/**
 * Sleep stage types, following Health Connect's sleep stages.
 * "sleeping" is generic sleep when the source has no finer stage.
 */
export const SLEEP_STAGE_TYPES = [
  'awake',
  'sleeping',
  'out_of_bed',
  'light',
  'deep',
  'rem',
  'awake_in_bed',
  'unknown',
] as const

export type SleepStageType = (typeof SLEEP_STAGE_TYPES)[number]

/**
 * One sleep stage interval as reported by the source. Stored as received:
 * stages that overlap or fall outside the session are kept and handled
 * by the sleep engine, never silently dropped.
 */
export interface SleepStage {
  start: string
  end: string
  stage: SleepStageType
}

/**
 * One ORIGINAL sleep session (schema version 6), manual or imported.
 *
 * Merged nights are calculated by the sleep engine and never stored, so
 * original records are never altered by processing (PROJECT_SPEC.md §4.5).
 *
 * Time: startUtc/endUtc are UTC instants. The local time of the session
 * comes from "timezone" (IANA) when known, otherwise from the UTC offsets
 * reported by the source (Health Connect reports offsets, not zone names).
 * At least one of timezone and startOffsetMinutes is set.
 */
export interface SleepSession extends BaseRecord, SyncFields {
  source: DataSource
  /** Identifier in the source system (e.g. Health Connect record id). */
  externalId: string | null
  /** Application that recorded the data (e.g. an Android package name). */
  sourceApp: string | null
  /**
   * Unique deterministic key used to prevent duplicate imports:
   * "manual:<id>", "<source>:id:<externalId>" or, without an external id,
   * "<source>:time:<startUtc>:<endUtc>".
   */
  dedupeKey: string
  startUtc: string
  endUtc: string
  timezone: string | null
  startOffsetMinutes: number | null
  endOffsetMinutes: number | null
  /** Stage intervals reported by the source ([] when none). */
  stages: SleepStage[]
  /** Total sleep reported by the source, in ms, as received (may be invalid). */
  reportedSleepMs: number | null
  /** The user's comment (editable, also for imported sessions). */
  comment: string | null
  /** When the session was imported; null for manual sessions. */
  importedAt: string | null
  /** Original extra data from the source, preserved unchanged. */
  metadata: Record<string, unknown> | null
}

/**
 * One imported health measurement (schema version 6), e.g. heart rate.
 * Original values and metadata are preserved unchanged.
 */
export interface ExternalSample extends BaseRecord, SyncFields {
  source: DataSource
  externalId: string | null
  sourceApp: string | null
  /** Unique deterministic key (see SleepSession.dedupeKey). */
  dedupeKey: string
  measurementType: string
  value: number
  unit: string | null
  startUtc: string
  endUtc: string | null
  timezone: string | null
  startOffsetMinutes: number | null
  importedAt: string
  metadata: Record<string, unknown> | null
}

/**
 * One application setting, stored by key (schema version 5).
 * Since version 8 settings carry sync fields and are soft-deleted
 * (deletedAt) instead of removed, so a removal can be synchronised.
 */
/**
 * A birthday: "YYYY-MM-DD" when the year is known, "--MM-DD" when only the
 * day and month are (phone contacts often store no year). Never a time:
 * a birthday is a calendar date, not an instant.
 */
export type ContactBirthday = string

/**
 * A person in the Personal CRM (schema version 9).
 *
 * Text fields are trimmed; an empty field is stored as null (unknown),
 * never as "". externalPhoneId is the phone contact's identifier when the
 * contact was imported from the phone (used to detect duplicates), else
 * null.
 */
export interface Contact extends BaseRecord, SyncFields {
  name: string
  description: string | null
  education: string | null
  address: string | null
  birthday: ContactBirthday | null
  interests: string | null
  dislikes: string | null
  externalPhoneId: string | null
}

/**
 * One logged interaction with a contact (schema version 9).
 *
 * occurredStart is a UTC instant (ISO string) and timezone the IANA zone
 * it was logged in, like habit entries, so the local date and time are
 * shown correctly after travel or a clock change.
 */
export interface ContactInteraction extends BaseRecord, SyncFields {
  contactId: string
  occurredStart: string
  timezone: string
  text: string
}

export interface SettingRecord extends SyncFields {
  key: string
  value: string
  updatedAt: string
  deletedAt: string | null
}

/**
 * This device's link to a sync account (schema version 8). At most one
 * record, id "current"; no record means syncing is not set up.
 * Device-only: never synchronised and never included in backups.
 */
export interface SyncStateRecord {
  id: 'current'
  /** Supabase user id of the linked account. */
  userId: string
  /** Highest server_seq already downloaded (0 before the first pull). */
  lastServerSeq: number
  keyVersion: number
  /** The unwrapped data key, non-extractable (docs/SYNC_DESIGN.md §3). */
  dataKey: CryptoKey
  linkedAt: string
}

/**
 * A synchronisation issue waiting for the user (schema version 8).
 * Device-only: never synchronised and never included in backups.
 *
 * - conflict: both this device and the server changed the record; the
 *   server version is kept here until the user chooses (SYNC_DESIGN.md §6).
 *   remoteRecord is null when the server copy is missing.
 * - invalid-remote: the server version decrypted but failed validation
 *   (for example made by a newer app version); never applied, never
 *   dropped (SYNC_DESIGN.md §6 rule 9).
 */
export type SyncConflictRecord =
  | (SyncConflictCommon & {
      kind: 'conflict'
      remoteRecord: unknown
      remoteRevision: number | null
    })
  | (SyncConflictCommon & {
      kind: 'invalid-remote'
      remoteRecord: unknown
      remoteRevision: number
      reason: string
    })

interface SyncConflictCommon {
  /** "<collection>:<recordId>" */
  id: string
  collection: 'habits' | 'entries' | 'sleepSessions' | 'settings' | 'externalSamples' | 'contacts' | 'contactInteractions'
  recordId: string
  detectedAt: string
}
