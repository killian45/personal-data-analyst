import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { db } from '../database/db'
import type { ExternalSample } from '../database/types'

import { applyLocationImport, locationResultText, planLocationImport, previewLocationImport } from './locationImport'
import { movement, timelineJson, visit } from './testTimeline'

const NOW = '2026-11-11T09:00:00.000Z'
function options() {
  let next = 0
  return { importedAt: NOW, newId: () => `loc-${(next += 1)}` }
}

const FILE = {
  fileName: 'Timeline.json',
  text: timelineJson([
    visit('2026-11-09T08:00:00.000+01:00', '2026-11-09T12:00:00.000+01:00'),
    movement('2026-11-09T12:00:00.000+01:00', '2026-11-09T12:20:00.000+01:00'),
  ]),
}

describe('planLocationImport', () => {
  it('turns visits and movements into imported samples, keeping original precision and offsets', () => {
    const plan = planLocationImport(FILE, [], options())
    expect(plan.toAdd).toEqual([
      {
        id: 'loc-1',
        source: 'import',
        externalId: null,
        sourceApp: 'Google Timeline',
        dedupeKey: 'location:import:visit:2026-11-09T07:00:00.000Z:2026-11-09T11:00:00.000Z:PLACE_A',
        measurementType: 'location_visit',
        value: 14_400,
        unit: 's',
        startUtc: '2026-11-09T07:00:00.000Z',
        endUtc: '2026-11-09T11:00:00.000Z',
        timezone: null,
        startOffsetMinutes: 60,
        importedAt: NOW,
        metadata: {
          format: 1, placeId: 'PLACE_A', lat: 45.0000001, lng: 5.0000002, semanticType: 'HOME',
          probability: 0.9, placeProbability: 0.8, hierarchyLevel: 0, endOffsetMinutes: 60, fileName: 'Timeline.json',
        },
        syncStatus: 'pending', revision: 1, syncedRevision: null, createdAt: NOW, updatedAt: NOW, deletedAt: null,
      },
      expect.objectContaining({
        id: 'loc-2',
        dedupeKey: 'location:import:movement:2026-11-09T11:00:00.000Z:2026-11-09T11:20:00.000Z',
        measurementType: 'location_movement',
        value: 3210.5,
        unit: 'm',
        metadata: expect.objectContaining({ activityType: 'CYCLING', startLat: 45.0000001, endLng: -5.02 }),
      }),
    ])
    expect([plan.visitsFound, plan.movementsFound, plan.firstUtc, plan.lastUtc]).toEqual([1, 1, '2026-11-09T07:00:00.000Z', '2026-11-09T11:00:00.000Z'])
    expect(plan.notImported.map((item) => item.label)).toContain('raw signals (GPS positions, motion, Wi-Fi scans)')
  })

  it('skips segments already imported and lists deleted ones for attention', () => {
    const first = planLocationImport(FILE, [], options()).toAdd
    const again = planLocationImport(FILE, first, options())
    expect(again.toAdd).toEqual([])
    expect(again.duplicates.map((item) => item.reason)).toEqual(['already imported', 'already imported'])
    expect(again.duplicates[0].label).toBe('Visit 09/11/2026 08:00 (Home)')

    const deleted = planLocationImport(FILE, [{ ...first[0], deletedAt: NOW }, first[1]], options())
    expect(deleted.needsAttention[0].reason).toMatch(/restore it from Deleted data/)
  })

  it('corrects a stored segment whose UTC offset was read wrongly before (only that, on confirmation)', () => {
    const [visit] = planLocationImport(FILE, [], options()).toAdd
    const misread = { ...visit, startOffsetMinutes: 120, revision: 3, syncStatus: 'synced' as const, syncedRevision: 3 }
    const plan = planLocationImport(FILE, [misread, planLocationImport(FILE, [], options()).toAdd[1]], options())

    expect(plan.toAdd).toEqual([])
    expect(plan.duplicates).toHaveLength(1)
    expect(plan.corrections).toHaveLength(1)
    expect(plan.corrections[0].after).toEqual({
      ...misread,
      startOffsetMinutes: 60,
      metadata: { ...misread.metadata, endOffsetMinutes: 60 },
      revision: 4,
      syncStatus: 'pending',
      updatedAt: NOW,
    })
    expect(locationResultText(plan, 0)).toBe('Imported 0 location segments (0 visits, 0 movements). 1 corrected (time offset). 1 skipped as duplicates.')
  })

  it('does not import a revised segment that overlaps a stored one of the same kind and level', () => {
    const stored = planLocationImport(FILE, [], options()).toAdd
    const revised = planLocationImport({
      fileName: 'Timeline-2.json',
      text: timelineJson([
        // Same visit, Google moved its end: overlaps → attention.
        visit('2026-11-09T08:00:00.000+01:00', '2026-11-09T12:05:00.000+01:00'),
        // A nested visit (level 1) inside the stored one: different level → imported.
        visit('2026-11-09T09:00:00.000+01:00', '2026-11-09T10:00:00.000+01:00', {
          visit: { hierarchyLevel: 1, topCandidate: { placeId: 'SHOP', semanticType: 'UNKNOWN', placeLocation: { latLng: '45.1°, 5.1°' } } },
        }),
        // A new movement later the same day → imported.
        movement('2026-11-09T18:00:00.000+01:00', '2026-11-09T18:30:00.000+01:00'),
      ]),
    }, stored, options())

    expect(revised.needsAttention).toEqual([{ label: 'Visit 09/11/2026 08:00 (Home)', reason: 'overlaps a visit already in the app (Google may have revised it); the one already in the app was kept' }])
    expect(revised.toAdd.map((sample) => [sample.measurementType, sample.metadata?.hierarchyLevel ?? null])).toEqual([
      ['location_visit', 1],
      ['location_movement', null],
    ])
  })

  it('lists invalid segments and duplicates within the file', () => {
    const plan = planLocationImport({
      fileName: 'x.json',
      text: timelineJson([
        visit('2026-11-09T08:00:00.000+01:00', '2026-11-09T12:00:00.000+01:00'),
        visit('2026-11-09T08:00:00.000+01:00', '2026-11-09T12:00:00.000+01:00'),
        visit('2026-11-09T08:00:00', '2026-11-09T12:00:00.000+01:00'),
        visit('2026-10-01T08:00:00.000+01:00', '2026-11-09T12:00:00.000+01:00'), // 39 days
      ]),
    }, [], options())
    expect(plan.toAdd).toHaveLength(1)
    expect(plan.duplicates[0].reason).toBe('listed twice in the file')
    expect(plan.invalid).toEqual([
      { label: 'Segment 3 (2026-11-09 08:00)', reason: 'start or end time missing or not readable' },
      { label: 'Segment 4', reason: 'the end must be after the start, at most 31 days later' },
    ])
  })

  it('reports file-level problems as errors', () => {
    expect(() => planLocationImport({ fileName: 'x', text: '{"timelineObjects": []}' }, [], options())).toThrow(/older Google Takeout/)
  })

  it('summarises the result', () => {
    const plan = planLocationImport(FILE, [], options())
    expect(locationResultText(plan, 2)).toBe('Imported 2 location segments (1 visit, 1 movement).')
  })
})

describe('preview and import (database)', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(async () => {
    db.close()
    await db.delete()
  })

  it('writes nothing on preview, adds all on import, and finds only duplicates the second time', async () => {
    const plan = await previewLocationImport(FILE.fileName, FILE.text)
    expect(await db.externalSamples.count()).toBe(0)
    expect(await applyLocationImport(plan)).toBe(2)
    const again = await previewLocationImport(FILE.fileName, FILE.text)
    expect(again.toAdd).toEqual([])
    expect(again.duplicates).toHaveLength(2)
  })

  it('applies a correction, and refuses it if the segment changed since the preview', async () => {
    const first = await previewLocationImport(FILE.fileName, FILE.text)
    await applyLocationImport(first)
    const stored = (await db.externalSamples.toArray()).find((sample) => sample.measurementType === 'location_visit')!
    await db.externalSamples.put({ ...stored, startOffsetMinutes: 120 })

    const plan = await previewLocationImport(FILE.fileName, FILE.text)
    expect(plan.corrections).toHaveLength(1)
    await applyLocationImport(plan)
    expect((await db.externalSamples.get(stored.id))?.startOffsetMinutes).toBe(60)

    // Changed meanwhile → nothing applied.
    await db.externalSamples.put({ ...(await db.externalSamples.get(stored.id))!, startOffsetMinutes: 120, revision: 10 })
    const stale = await previewLocationImport(FILE.fileName, FILE.text)
    await db.externalSamples.put({ ...(await db.externalSamples.get(stored.id))!, revision: 11 })
    await expect(applyLocationImport(stale)).rejects.toThrow(/Nothing was imported/)
    expect((await db.externalSamples.get(stored.id))?.startOffsetMinutes).toBe(120)
  })

  it('imports nothing if a segment was added meanwhile', async () => {
    const plan = await previewLocationImport(FILE.fileName, FILE.text)
    await db.externalSamples.add(plan.toAdd[1] as ExternalSample)
    await expect(applyLocationImport(plan)).rejects.toThrow(/Nothing was imported/)
    expect(await db.externalSamples.count()).toBe(1)
  })
})
