import { describe, expect, it } from 'vitest'

import { describeSyncResult, differingFields, formatFieldValue, issueTitle } from './describe'
import type { SyncRoundResult } from './engine'

const counts = { pulled: 0, applied: 0, conflicts: 0, problems: 0, pushed: 0, stale: 0 }

describe('describeSyncResult', () => {
  it('a clean round', () => {
    expect(describeSyncResult({ status: 'ok', notPushed: [], ...counts, applied: 1, pushed: 3 })).toEqual({
      tone: 'ok',
      text: 'Sync finished. Received 1 change, sent 3 changes.',
    })
  })

  it('a round with conflicts, problems and refused records is a warning', () => {
    const result: SyncRoundResult = {
      status: 'ok',
      notPushed: [{ collection: 'habits', recordId: 'h', reason: 'too large to synchronise' }],
      ...counts,
      conflicts: 2,
      problems: 1,
    }
    const { tone, text } = describeSyncResult(result)
    expect(tone).toBe('warning')
    expect(text).toContain('2 new conflicts need your choice')
    expect(text).toContain('1 record from the server could not be used')
    expect(text).toContain('1 record was not sent: too large to synchronise')
  })

  it('network failures reassure that changes are kept', () => {
    const result: SyncRoundResult = {
      status: 'failed', stage: 'push', kind: 'network', message: 'x', notPushed: [], ...counts,
    }
    expect(describeSyncResult(result)).toEqual({
      tone: 'warning',
      text: 'Could not reach the sync server. Your changes are kept on this device and will be sent next time.',
    })
  })

  it('explains every other outcome', () => {
    for (const status of ['signed-out', 'account-mismatch', 'cloud-deleted', 'key-changed', 'not-set-up', 'busy'] as const) {
      expect(describeSyncResult({ status }).text.length).toBeGreaterThan(10)
    }
    expect(describeSyncResult({ status: 'cloud-deleted' }).text).toContain('All data on this device is kept')
  })
})

describe('field formatting', () => {
  const zone = 'Europe/Paris'

  it('shows times as dd/mm/yyyy HH:mm in the display timezone (24-hour)', () => {
    expect(formatFieldValue('occurredStart', '2026-11-09T21:30:00.000Z', zone)).toBe('09/11/2026 22:30')
  })

  it('shows deletions, empty values, booleans and stages readably', () => {
    expect(formatFieldValue('deletedAt', null, zone)).toBe('No')
    expect(formatFieldValue('deletedAt', '2026-11-09T21:30:00.000Z', zone)).toBe('Yes (09/11/2026 22:30)')
    expect(formatFieldValue('comment', null, zone)).toBe('—')
    expect(formatFieldValue('archived', true, zone)).toBe('Yes')
    expect(formatFieldValue('stages', [{}, {}], zone)).toBe('2 stages')
  })

  it('lists only the content fields that differ', () => {
    const local = { id: 'e', comment: 'A', value: 1, updatedAt: 'x', revision: 3, deletedAt: null }
    const other = { id: 'e', comment: 'B', value: 1, updatedAt: 'y', revision: 4, deletedAt: '2026-11-09T21:30:00.000Z' }
    expect(differingFields(local, other, zone)).toEqual([
      { field: 'comment', label: 'Comment', thisDevice: 'A', otherDevice: 'B' },
      { field: 'deletedAt', label: 'Deleted', thisDevice: 'No', otherDevice: 'Yes (09/11/2026 22:30)' },
    ])
  })

  it('titles records by kind', () => {
    expect(issueTitle('habits', { name: 'Water' }, 'h', zone)).toBe('Habit “Water”')
    expect(issueTitle('entries', { occurredStart: '2026-11-09T07:00:00.000Z' }, 'e', zone, 'Water')).toBe(
      'Water, 09/11/2026 08:00',
    )
    expect(issueTitle('settings', undefined, 'target.bedtime', zone)).toBe('Setting: Bedtime target')
    expect(
      issueTitle('sleepSessions', { startUtc: '2026-11-08T22:00:00.000Z', endUtc: '2026-11-09T06:00:00.000Z' }, 's', zone),
    ).toBe('Sleep 08/11/2026 23:00 → 09/11/2026 07:00')
  })

  it('describes Personal CRM records and their fields', () => {
    const zone = 'Europe/Paris'
    expect(issueTitle('contacts', { name: 'Bob' }, 'c', zone)).toBe('Contact “Bob”')
    expect(issueTitle('contacts', undefined, 'c', zone)).toBe('A contact')
    expect(issueTitle('contactInteractions', { occurredStart: '2026-11-09T07:00:00.000Z' }, 'i', zone, undefined, 'Bob')).toBe(
      'Interaction with Bob, 09/11/2026 08:00',
    )
    expect(differingFields({ interests: 'Chess' }, { interests: 'Jazz' }, zone)).toEqual([
      { field: 'interests', label: 'Interests & likes', thisDevice: 'Chess', otherDevice: 'Jazz' },
    ])
  })

  it('tells the user to update when another device uses a newer app version', () => {
    const result = {
      status: 'failed', stage: 'pull', kind: 'invalid-response', message: 'unknown collection from the server',
      notPushed: [], pulled: 0, applied: 0, conflicts: 0, problems: 0, pushed: 0, stale: 0,
    } as SyncRoundResult
    expect(describeSyncResult(result)).toEqual({
      tone: 'error',
      text: 'Sync stopped: another device uses a newer version of the app. Update the app on this device; your changes are kept.',
    })
  })

  it('warns when the server sent older versions than this device had', () => {
    expect(describeSyncResult({ status: 'ok', notPushed: [], ...counts, stale: 2, pushed: 2 })).toEqual({
      tone: 'warning',
      text: "Sync finished. Received 0 changes, sent 2 changes. The server sent an older version of 2 records than this device already had (for example after a server restore); they were ignored and this device's newer version was sent again.",
    })
  })
})

