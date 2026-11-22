import { describe, expect, it } from 'vitest'

import type { ExternalSample } from '../database/types'
import { screenTimeSample } from '../screenTime/testScreenTime'
import { USAGE_EVENT as E } from '../screenTime/usageEvents'
import type { UsageEventsData } from '../screenTime/usageEvents'

import { deviceScreenTimeResultText, planDeviceScreenTimeImport } from './deviceScreenTimeImport'
import type { PhoneUsageData } from './deviceScreenTimeImport'

const t = (iso: string) => Date.parse(iso)
const NOW = t('2026-11-11T09:00:00Z') // 10:00 in Paris

/** Made-up phone data (Paris, UTC+1): history from 8 Nov 15:00 Paris. */
function phone(changes: Partial<PhoneUsageData> = {}): PhoneUsageData {
  const events: UsageEventsData = {
    packages: ['com.chat', 'com.launcher', 'com.gone'],
    classes: ['Main'],
    events: [
      // 8 Nov (incomplete day): 30 min of chat.
      [t('2026-11-08T15:00:00Z'), E.ACTIVITY_RESUMED, 0, 0],
      [t('2026-11-08T15:30:00Z'), E.ACTIVITY_PAUSED, 0, 0],
      // 9 Nov: 1 h chat, 10 min home screen, 5 min of an app without a name.
      [t('2026-11-09T08:00:00Z'), E.ACTIVITY_RESUMED, 0, 0],
      [t('2026-11-09T09:00:00Z'), E.ACTIVITY_PAUSED, 0, 0],
      [t('2026-11-09T09:00:00Z'), E.ACTIVITY_RESUMED, 1, 0],
      [t('2026-11-09T09:10:00Z'), E.ACTIVITY_PAUSED, 1, 0],
      [t('2026-11-09T09:10:00Z'), E.ACTIVITY_RESUMED, 2, 0],
      [t('2026-11-09T09:15:00Z'), E.SCREEN_NON_INTERACTIVE, 2, -1],
      // 10 Nov: nothing. 11 Nov (today): 20 min.
      [t('2026-11-11T08:00:00Z'), E.ACTIVITY_RESUMED, 0, 0],
      [t('2026-11-11T08:20:00Z'), E.ACTIVITY_PAUSED, 0, 0],
    ],
  }
  return {
    events,
    covered: [{ startMs: t('2026-11-08T14:00:00Z'), endMs: NOW }],
    nowMs: NOW,
    homePackages: ['com.launcher'],
    labels: { 'com.chat': 'Chat', 'com.launcher': 'Home' },
    ...changes,
  }
}

const options = { importedAt: '2026-11-11T09:00:00.000Z', newId: () => 'new-id', timezone: 'Europe/Paris' }

describe('planDeviceScreenTimeImport', () => {
  it('imports complete finished days without the home screen, with app names', () => {
    const plan = planDeviceScreenTimeImport(phone(), [], options)

    expect(plan.toAdd).toEqual([
      {
        id: 'new-id',
        source: 'android_usage',
        externalId: null,
        sourceApp: 'Android (Usage access)',
        dedupeKey: 'screen_time:android_usage:2026-11-09',
        measurementType: 'screen_time_daily',
        value: 3900, // 60 + 5 min; the 10 min of home screen are left out
        unit: 's',
        startUtc: '2026-11-08T23:00:00.000Z',
        endUtc: '2026-11-09T23:00:00.000Z',
        timezone: 'Europe/Paris',
        startOffsetMinutes: 60,
        importedAt: '2026-11-11T09:00:00.000Z',
        metadata: {
          format: 1,
          localDate: '2026-11-09',
          apps: [
            { name: 'Chat', package: 'com.chat', seconds: 3600, opens: null },
            { name: 'com.gone', package: 'com.gone', seconds: 300, opens: null },
          ],
          method: 'android_events_without_home_v1',
        },
        syncStatus: 'pending',
        revision: 1,
        syncedRevision: null,
        createdAt: '2026-11-11T09:00:00.000Z',
        updatedAt: '2026-11-11T09:00:00.000Z',
        deletedAt: null,
      },
    ])
    expect([plan.found, plan.firstDate, plan.lastDate]).toEqual([1, '2026-11-09', '2026-11-09'])
  })

  it('lists the incomplete first day and empty days instead of storing them; never today', () => {
    const plan = planDeviceScreenTimeImport(phone(), [], options)
    expect(plan.skipped).toEqual([
      { label: 'Screen time 08/11/2026', reason: 'only part of this day is available (in Android or in the saved history), so its total would be too low' },
      { label: 'Screen time 10/11/2026', reason: 'no phone use was recorded (not stored: a missing day is never counted as 0)' },
    ])
    expect(plan.toAdd.map((sample) => sample.metadata?.localDate)).not.toContain('2026-11-11')
  })

  it('uses the same duplicate rules as the file import, comparing apps by package', () => {
    const first = planDeviceScreenTimeImport(phone(), [], options).toAdd[0]
    const stored: ExternalSample = { ...first, id: 'old' }

    // Same figures, app renamed since: still a duplicate.
    const again = planDeviceScreenTimeImport(phone({ labels: { 'com.chat': 'Chat (new name)' } }), [stored], options)
    expect(again.toAdd).toEqual([])
    expect(again.duplicates).toEqual([{ label: 'Screen time 09/11/2026', reason: 'already imported' }])

    // Different figures: kept, listed.
    const changed = planDeviceScreenTimeImport(phone(), [{ ...stored, value: 10 }], options)
    expect(changed.needsAttention[0].reason).toMatch(/version already in the app was kept/)

    // An App Usage file for the same day is another source: no clash.
    const withFile = planDeviceScreenTimeImport(phone(), [screenTimeSample('file-9', '2026-11-09')], options)
    expect(withFile.toAdd).toHaveLength(1)
  })

  it('imports older days from the saved copy, with names saved before an app was uninstalled', () => {
    // Saved copy from 1 Nov (Android itself only has data from 8 Nov 15:00).
    const base = phone()
    const events: UsageEventsData = {
      packages: [...base.events.packages, 'com.game'],
      classes: base.events.classes,
      events: [
        ...base.events.events,
        [t('2026-11-05T18:00:00Z'), E.ACTIVITY_RESUMED, 3, 0],
        [t('2026-11-05T18:45:00Z'), E.ACTIVITY_PAUSED, 3, 0],
      ],
    }
    const plan = planDeviceScreenTimeImport({
      ...base,
      events,
      covered: [
        { startMs: t('2026-11-01T10:00:00Z'), endMs: t('2026-11-09T12:00:00Z') }, // saved copy
        { startMs: t('2026-11-08T14:00:00Z'), endMs: NOW }, // Android
      ],
      labels: { ...base.labels, 'com.game': 'Some Game' },
    }, [], options)

    const fifth = plan.toAdd.find((sample) => sample.metadata?.localDate === '2026-11-05')
    expect(fifth?.value).toBe(45 * 60)
    expect(fifth?.metadata?.apps).toEqual([{ name: 'Some Game', package: 'com.game', seconds: 2700, opens: null }])
    // 1 Nov is incomplete (saved copy starts during it). 8 Nov, incomplete in
    // Android alone, is now complete thanks to the saved copy (30 min).
    expect(plan.skipped.map((issue) => issue.label)[0]).toBe('Screen time 01/11/2026')
    expect(plan.toAdd.map((sample) => [sample.metadata?.localDate, sample.value])).toEqual([
      ['2026-11-05', 2700],
      ['2026-11-08', 1800],
      ['2026-11-09', 3900],
    ])
  })

  it('reports restarts without shutdown and unreadable events', () => {
    const base = phone()
    const events: UsageEventsData = {
      ...base.events,
      events: [
        ...base.events.events,
        [t('2026-11-09T12:00:00Z'), E.ACTIVITY_RESUMED, 0, 0],
        [t('2026-11-09T13:00:00Z'), E.DEVICE_STARTUP, 1, -1],
        [t('2026-11-09T13:00:00Z'), E.ACTIVITY_RESUMED, 99, 0],
      ],
    }
    const plan = planDeviceScreenTimeImport({ ...base, events }, [], options)
    expect(plan.toAdd[0].value).toBe(3900)
    expect(plan.notes).toEqual([
      expect.stringMatching(/^1 on-screen period\(s\) ended with a phone restart/),
      expect.stringMatching(/^1 usage event\(s\) from Android could not be read/),
    ])
  })

  it('handles a phone without any history', () => {
    const plan = planDeviceScreenTimeImport(phone({ covered: [], events: { packages: [], events: [] } }), [], options)
    expect(plan.toAdd).toEqual([])
    expect(plan.notes).toEqual(['Android has no usage history on this phone yet.'])
  })

  it('summarises the result', () => {
    const plan = planDeviceScreenTimeImport(phone(), [], options)
    expect(deviceScreenTimeResultText(plan, 1)).toBe('Imported screen time for 1 day. 2 incomplete or empty day(s) not imported.')
  })
})
