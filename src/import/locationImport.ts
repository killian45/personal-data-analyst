import { messages } from '../i18n'
import { db } from '../database/db'
import { initialSyncFields, nextSyncFields } from '../database/sync'
import type { ExternalSample } from '../database/types'
import {
  LOCATION_FORMAT,
  LOCATION_MOVEMENT,
  LOCATION_TYPES,
  LOCATION_VISIT,
  buildLocationDedupeKey,
  placeTypeLabel,
  validateLocationSample,
} from '../location/location'
import type { MovementMetadata, VisitMetadata } from '../location/location'
import { formatInTimezone, offsetToZoneName } from '../time/time'

import type { ImportIssue } from './sleepImport'
import { parseTimeline } from './timeline'
import type { TimelineMovement, TimelineVisit } from './timeline'

/**
 * Location import from a Google Timeline export (docs/PHASE5_PLAN.md §7).
 * Same framework as the other imports: a preview that writes nothing,
 * then one all-or-nothing transaction.
 *
 * Duplicates (the export has no record ids):
 * - same kind, start, end (and place for visits) as a stored segment →
 *   skipped as duplicate (or "needs attention" if that one was deleted);
 * - a new segment overlapping a stored one of the same kind (and the same
 *   place level for visits) but not identical → "needs attention": Google
 *   may have revised it; not imported, the stored one is kept.
 * Stored segments are never replaced, with one exception: a stored
 * segment identical to the file's except for a UTC offset that an earlier
 * version of this reader took from the wrong field is CORRECTED to match
 * the file (listed in the preview, applied only on confirmation).
 */

export const TIMELINE_SOURCE_APP = 'Google Timeline'

export interface LocationImportPlan {
  fileName: string
  visitsFound: number
  movementsFound: number
  toAdd: ExternalSample[]
  /** Stored segments whose UTC offsets are corrected to match the file. */
  corrections: { label: string; before: ExternalSample; after: ExternalSample }[]
  duplicates: ImportIssue[]
  needsAttention: ImportIssue[]
  invalid: ImportIssue[]
  notImported: { label: string; count: number }[]
  firstUtc: string | null
  lastUtc: string | null
}

function localLabel(utc: string, offsetMinutes: number): string {
  return formatInTimezone(utc, offsetToZoneName(offsetMinutes), 'dd/MM/yyyy HH:mm')
}

function label(sample: ExternalSample): string {
  const when = localLabel(sample.startUtc, sample.startOffsetMinutes ?? 0)
  if (sample.measurementType === LOCATION_VISIT) {
    return messages().importText.location.visit(when, placeTypeLabel(String(sample.metadata?.semanticType)))
  }
  return messages().importText.location.movement(when, placeTypeLabel(String(sample.metadata?.activityType)))
}

function visitSample(visit: TimelineVisit, fileName: string, base: Pick<ExternalSample, 'id' | 'importedAt'>): ExternalSample {
  const metadata: VisitMetadata = {
    format: LOCATION_FORMAT,
    placeId: visit.placeId,
    lat: visit.lat,
    lng: visit.lng,
    semanticType: visit.semanticType,
    probability: visit.probability,
    placeProbability: visit.placeProbability,
    hierarchyLevel: visit.hierarchyLevel,
    endOffsetMinutes: visit.end.offsetMinutes,
    fileName,
  }
  return {
    id: base.id,
    source: 'import',
    externalId: null,
    sourceApp: TIMELINE_SOURCE_APP,
    dedupeKey: buildLocationDedupeKey('import', LOCATION_VISIT, visit.start.utc, visit.end.utc, visit.placeId),
    measurementType: LOCATION_VISIT,
    value: Math.round((Date.parse(visit.end.utc) - Date.parse(visit.start.utc)) / 1000),
    unit: 's',
    startUtc: visit.start.utc,
    endUtc: visit.end.utc,
    timezone: null,
    startOffsetMinutes: visit.start.offsetMinutes,
    importedAt: base.importedAt,
    metadata,
    ...initialSyncFields(),
    createdAt: base.importedAt,
    updatedAt: base.importedAt,
    deletedAt: null,
  }
}

function movementSample(movement: TimelineMovement, fileName: string, base: Pick<ExternalSample, 'id' | 'importedAt'>): ExternalSample {
  const metadata: MovementMetadata = {
    format: LOCATION_FORMAT,
    activityType: movement.activityType,
    probability: movement.probability,
    typeProbability: movement.typeProbability,
    startLat: movement.startLat,
    startLng: movement.startLng,
    endLat: movement.endLat,
    endLng: movement.endLng,
    endOffsetMinutes: movement.end.offsetMinutes,
    fileName,
  }
  return {
    id: base.id,
    source: 'import',
    externalId: null,
    sourceApp: TIMELINE_SOURCE_APP,
    dedupeKey: buildLocationDedupeKey('import', LOCATION_MOVEMENT, movement.start.utc, movement.end.utc, null),
    measurementType: LOCATION_MOVEMENT,
    value: movement.distanceMeters,
    unit: 'm',
    startUtc: movement.start.utc,
    endUtc: movement.end.utc,
    timezone: null,
    startOffsetMinutes: movement.start.offsetMinutes,
    importedAt: base.importedAt,
    metadata,
    ...initialSyncFields(),
    createdAt: base.importedAt,
    updatedAt: base.importedAt,
    deletedAt: null,
  }
}

/** Same kind (and the same place level for visits). */
function comparable(a: ExternalSample, b: ExternalSample): boolean {
  if (a.measurementType !== b.measurementType) return false
  return a.measurementType !== LOCATION_VISIT || (a.metadata?.hierarchyLevel ?? null) === (b.metadata?.hierarchyLevel ?? null)
}

function overlaps(a: ExternalSample, b: ExternalSample): boolean {
  return a.startUtc < (b.endUtc as string) && b.startUtc < (a.endUtc as string)
}

/** Plans the import of a Timeline export. Pure: does not touch the database. */
export function planLocationImport(
  input: { fileName: string; text: string },
  existing: readonly ExternalSample[],
  options: { importedAt: string; newId: () => string },
): LocationImportPlan {
  const data = parseTimeline(input.text)
  const plan: LocationImportPlan = {
    fileName: input.fileName,
    visitsFound: data.visits.length,
    movementsFound: data.movements.length,
    toAdd: [],
    corrections: [],
    duplicates: [],
    needsAttention: [],
    invalid: data.invalid.map((item) => ({
      label: `Segment ${item.index + 1}${item.when ? ` (${item.when.slice(0, 16).replace('T', ' ')})` : ''}`,
      reason: item.reason,
    })),
    notImported: data.notImported,
    firstUtc: null,
    lastUtc: null,
  }

  const candidates = [
    ...data.visits.map((visit) => ({ index: visit.index, build: (id: string) => visitSample(visit, input.fileName, { id, importedAt: options.importedAt }) })),
    ...data.movements.map((movement) => ({ index: movement.index, build: (id: string) => movementSample(movement, input.fileName, { id, importedAt: options.importedAt }) })),
  ].sort((a, b) => a.index - b.index)

  const location = existing.filter((sample) => (LOCATION_TYPES as readonly string[]).includes(sample.measurementType))
  const byKey = new Map(location.map((sample) => [sample.dedupeKey, sample]))
  const active = location.filter((sample) => sample.deletedAt === null)
  const seen = new Set<string>()

  for (const candidate of candidates) {
    const sample = candidate.build(options.newId())
    try {
      validateLocationSample(sample)
    } catch (error) {
      plan.invalid.push({ label: `Segment ${candidate.index + 1}`, reason: error instanceof Error ? error.message : 'invalid segment' })
      continue
    }

    plan.firstUtc = plan.firstUtc === null || sample.startUtc < plan.firstUtc ? sample.startUtc : plan.firstUtc
    plan.lastUtc = plan.lastUtc === null || sample.startUtc > plan.lastUtc ? sample.startUtc : plan.lastUtc

    if (seen.has(sample.dedupeKey)) {
      plan.duplicates.push({ label: label(sample), reason: 'listed twice in the file' })
      continue
    }
    seen.add(sample.dedupeKey)

    const stored = byKey.get(sample.dedupeKey)
    if (stored) {
      if (stored.deletedAt !== null) {
        plan.needsAttention.push({ label: label(sample), reason: 'already imported and later deleted; restore it from Deleted data if you want it back' })
      } else if (
        stored.startOffsetMinutes !== sample.startOffsetMinutes ||
        (stored.metadata?.endOffsetMinutes ?? null) !== (sample.metadata?.endOffsetMinutes ?? null)
      ) {
        plan.corrections.push({
          label: label(sample),
          before: stored,
          after: {
            ...stored,
            startOffsetMinutes: sample.startOffsetMinutes,
            metadata: { ...stored.metadata, endOffsetMinutes: sample.metadata?.endOffsetMinutes ?? null },
            ...nextSyncFields(stored),
            updatedAt: options.importedAt,
          },
        })
      } else {
        plan.duplicates.push({ label: label(sample), reason: 'already imported' })
      }
      continue
    }

    const clash = active.find((other) => comparable(other, sample) && overlaps(other, sample))
    if (clash) {
      plan.needsAttention.push({
        label: label(sample),
        reason: `overlaps a ${clash.measurementType === LOCATION_VISIT ? 'visit' : 'movement'} already in the app (Google may have revised it); the one already in the app was kept`,
      })
      continue
    }

    plan.toAdd.push(sample)
  }

  return plan
}

/** Reads a Timeline export and plans the import. Writes nothing. */
export async function previewLocationImport(fileName: string, text: string): Promise<LocationImportPlan> {
  const existing = await db.externalSamples.where('measurementType').anyOf([...LOCATION_TYPES]).toArray()
  return planLocationImport({ fileName, text }, existing, { importedAt: new Date().toISOString(), newId: () => crypto.randomUUID() })
}

/** Adds the planned segments in one transaction; if anything fails, nothing is added. */
export async function applyLocationImport(plan: Pick<LocationImportPlan, 'toAdd'> & Partial<Pick<LocationImportPlan, 'corrections'>>): Promise<number> {
  try {
    await db.transaction('rw', db.externalSamples, async () => {
      for (const correction of plan.corrections ?? []) {
        const current = await db.externalSamples.get(correction.before.id)
        if (!current || current.revision !== correction.before.revision || current.deletedAt !== null) {
          throw new Error(messages().importText.location.segmentChanged)
        }
        await db.externalSamples.put(correction.after)
      }
      await db.externalSamples.bulkAdd(plan.toAdd)
    })
  } catch (caughtError) {
    console.error('Location import failed:', caughtError)
    throw new Error(messages().importText.changedSincePreview)
  }
  return plan.toAdd.length
}

export function locationResultText(plan: LocationImportPlan, imported: number): string {
  const visits = plan.toAdd.filter((sample) => sample.measurementType === LOCATION_VISIT).length
  return (
    messages().importText.locationImported(imported, visits, imported - visits) +
    (plan.corrections.length > 0 ? messages().importText.corrected(plan.corrections.length) : '') +
    (plan.duplicates.length > 0 ? messages().importText.skippedDuplicates(plan.duplicates.length) : '') +
    (plan.needsAttention.length > 0 ? messages().importText.needAttention(plan.needsAttention.length) : '') +
    (plan.invalid.length > 0 ? messages().importText.invalidNotImported(plan.invalid.length) : '')
  )
}
