/**
 * Plain-language descriptions of sync results and sync issues for the
 * interface. Pure functions (no database, no React).
 */

import { messages } from '../i18n'
import { formatInTimezone } from '../time/time'
import type { SyncRoundResult } from './engine'
import { contentOf } from './merge'
import type { SyncCollection } from './types'

export type Tone = 'ok' | 'warning' | 'error'

export function describeSyncResult(result: SyncRoundResult): { tone: Tone; text: string } {
  const t = messages().syncText
  switch (result.status) {
    case 'ok': {
      const parts = [t.received(result.applied, result.pushed)]
      if (result.conflicts > 0) {
        parts.push(t.conflicts(result.conflicts))
      }
      if (result.problems > 0) {
        parts.push(t.problems(result.problems))
      }
      if (result.stale > 0) {
        parts.push(t.stale(result.stale))
      }
      if (result.notPushed.length > 0) {
        parts.push(t.notPushed(result.notPushed.length, result.notPushed.map((n) => n.reason).join('; ')))
      }
      const tone: Tone = result.conflicts + result.problems + result.stale + result.notPushed.length > 0 ? 'warning' : 'ok'
      return { tone, text: t.finished(parts.join(' ')) }
    }
    case 'failed':
      if (result.kind === 'network') {
        return {
          tone: 'warning',
          text: t.network,
        }
      }
      if (result.kind === 'auth') {
        return { tone: 'error', text: t.auth }
      }
      if (result.message === 'unknown collection from the server') {
        return {
          tone: 'error',
          text: t.newerApp,
        }
      }
      return { tone: 'error', text: t.stopped(result.message) }
    case 'signed-out':
      return { tone: 'warning', text: t.signedOut }
    case 'account-mismatch':
      return { tone: 'error', text: t.accountMismatch }
    case 'cloud-deleted':
      return {
        tone: 'warning',
        text: t.cloudDeleted,
      }
    case 'key-changed':
      return { tone: 'error', text: t.keyChanged }
    case 'not-set-up':
      return { tone: 'warning', text: t.notSetUp }
    case 'busy':
      return { tone: 'ok', text: t.busy }
  }
}

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/

export function formatSyncTime(utc: string, zone: string): string {
  return formatInTimezone(utc, zone, 'dd/MM/yyyy HH:mm')
}

/** Labels: messages().syncText.fields / .settings (shown by field name otherwise). */


export function formatFieldValue(field: string, value: unknown, zone: string): string {
  const t = messages().syncText
  if (field === 'deletedAt') {
    return typeof value === 'string' && TIMESTAMP.test(value) ? t.yesAt(formatSyncTime(value, zone)) : t.no
  }
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? t.yes : t.no
  if (typeof value === 'string') return TIMESTAMP.test(value) ? formatSyncTime(value, zone) : value
  if (typeof value === 'number') return String(value)
  if (Array.isArray(value) && field === 'stages') return t.stages(value.length)
  const text = JSON.stringify(value)
  return text.length > 120 ? `${text.slice(0, 117)}…` : text
}

export interface FieldDifference {
  field: string
  label: string
  thisDevice: string
  otherDevice: string
}

/** Fields whose content differs between this device's and the other version. */
export function differingFields(local: object | undefined, other: object | undefined, zone: string): FieldDifference[] {
  const t = messages().syncText
  const a = local ? contentOf(local) : {}
  const b = other ? contentOf(other) : {}
  const fields = [...new Set([...Object.keys(a), ...Object.keys(b)])]
  return fields
    .filter((field) => JSON.stringify(a[field] ?? null) !== JSON.stringify(b[field] ?? null))
    .map((field) => ({
      field,
      label: t.fields[field] ?? field,
      thisDevice: local ? formatFieldValue(field, a[field], zone) : t.notOnDevice,
      otherDevice: other ? formatFieldValue(field, b[field], zone) : t.notUsable,
    }))
}

/** A short title for the record an issue is about. */
export function issueTitle(
  collection: SyncCollection,
  record: Record<string, unknown> | undefined,
  recordId: string,
  zone: string,
  habitName?: string,
  contactName?: string,
): string {
  const t = messages().syncText
  const time = (value: unknown) => (typeof value === 'string' && TIMESTAMP.test(value) ? formatSyncTime(value, zone) : '?')
  switch (collection) {
    case 'habits':
      return record && typeof record.name === 'string' ? t.habit(record.name) : t.aHabit
    case 'entries':
      return `${habitName ?? t.entry}, ${record ? time(record.occurredStart) : t.unknownTime}`
    case 'sleepSessions':
      return record ? t.sleep(time(record.startUtc), time(record.endUtc)) : t.aSleepSession
    case 'settings':
      return t.setting(t.settings[recordId] ?? recordId)
    case 'externalSamples': {
      const day = (record?.metadata as { localDate?: unknown } | null | undefined)?.localDate
      return typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day)
        ? t.screenTime(`${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`)
        : record?.measurementType === 'location_visit'
          ? t.visit(time(record.startUtc))
          : record?.measurementType === 'location_movement'
            ? t.movement(time(record.startUtc))
            : t.aSample
    }
    case 'contacts':
      return record && typeof record.name === 'string' ? t.contact(record.name) : t.aContact
    case 'contactInteractions':
      return t.interaction(contactName ?? t.someContact, record ? time(record.occurredStart) : t.unknownTime)
  }
}
