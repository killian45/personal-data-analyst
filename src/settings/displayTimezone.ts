import { messages } from '../i18n'
import { getSettingValue, putSetting } from '../database/settings'
import { getDeviceTimezone, isValidTimezone } from '../time/time'

/**
 * Display timezone setting (PROJECT_SPEC.md §5.1).
 *
 * - "event":  show each entry in the timezone where it happened (default).
 * - "device": show everything in the device's current timezone (follows
 *             the device when travelling).
 * - an IANA timezone, e.g. "Europe/Paris": always show that timezone.
 *
 * Stored in the "settings" table, so it is included in backups.
 * The stored event timezone of entries is never changed by this setting.
 */

export type DisplayTimezone = 'event' | 'device' | string

export const DISPLAY_TIMEZONE_KEY = 'displayTimezone'
export const DEFAULT_DISPLAY_TIMEZONE: DisplayTimezone = 'event'

export function isValidDisplayTimezone(value: unknown): value is DisplayTimezone {
  return value === 'event' || value === 'device' || isValidTimezone(value)
}

/**
 * The timezone in which an entry recorded in `eventTimezone` is shown.
 */
export function resolveDisplayZone(
  setting: DisplayTimezone,
  eventTimezone: string,
  deviceTimezone: string = getDeviceTimezone(),
): string {
  if (setting === 'event') {
    return eventTimezone
  }

  if (setting === 'device') {
    return deviceTimezone
  }

  return setting
}

/** Plain-language description, e.g. for "Times shown in: …". */
export function describeDisplayTimezone(
  setting: DisplayTimezone,
  deviceTimezone: string = getDeviceTimezone(),
): string {
  if (setting === 'event') {
    return 'the timezone where each entry happened'
  }

  if (setting === 'device') {
    return `this device's timezone (${deviceTimezone})`
  }

  return setting
}

/**
 * Reads the setting. Falls back to the default if it is missing or no
 * longer valid (e.g. a timezone name the browser does not know).
 */
export async function loadDisplayTimezone(): Promise<DisplayTimezone> {
  const value = await getSettingValue(DISPLAY_TIMEZONE_KEY)

  return value !== null && isValidDisplayTimezone(value)
    ? value
    : DEFAULT_DISPLAY_TIMEZONE
}

export async function saveDisplayTimezone(
  value: DisplayTimezone,
): Promise<DisplayTimezone> {
  const trimmed = value.trim()

  if (!isValidDisplayTimezone(trimmed)) {
    throw new Error(messages().validation.timezone)
  }

  await putSetting(DISPLAY_TIMEZONE_KEY, trimmed)

  return trimmed
}
