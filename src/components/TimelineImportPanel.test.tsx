import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { db } from '../database/db'
import { movement, timelineJson, visit } from '../import/testTimeline'

import { TimelineImportPanel } from './TimelineImportPanel'

const file = (text: string, name = 'Timeline.json') => new File([text], name, { type: 'application/json' })
const EXPORT = timelineJson([
  visit('2026-11-09T08:00:00.000+01:00', '2026-11-09T12:00:00.000+01:00'),
  movement('2026-11-09T12:00:00.000+01:00', '2026-11-09T12:20:00.000+01:00'),
])

function count(label: string) {
  const row = screen.getByRole('rowheader', { name: label }).closest('tr') as HTMLElement
  return within(row).getAllByRole('cell')[0].textContent
}

describe('TimelineImportPanel', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(async () => {
    cleanup()
    db.close()
    await db.delete()
  })

  it('previews, lists what is never imported, imports after confirmation, and skips it next time', async () => {
    const onImported = vi.fn()
    render(<TimelineImportPanel onImported={onImported} />)

    await userEvent.upload(screen.getByLabelText('Timeline export (.json)'), file(EXPORT))

    expect(await screen.findByText(/1 visit and 1 movement found, from 09\/11\/2026 to 09\/11\/2026/)).toBeInTheDocument()
    expect(count('Will be imported')).toBe('2')
    expect(screen.getByText(/raw signals \(GPS positions, motion, Wi-Fi scans\) \(2\)/)).toBeInTheDocument()
    expect(await db.externalSamples.count()).toBe(0)

    await userEvent.click(screen.getByRole('button', { name: 'Import 2 segments' }))
    expect(await screen.findByText('Imported 2 location segments (1 visit, 1 movement).')).toBeInTheDocument()
    expect(onImported).toHaveBeenCalledTimes(1)
    expect(await db.externalSamples.count()).toBe(2)

    await userEvent.upload(screen.getByLabelText('Timeline export (.json)'), file(EXPORT))
    expect(await screen.findByText('Nothing new to import.')).toBeInTheDocument()
    expect(count('Skipped duplicates')).toBe('2')
  })

  it('explains files that cannot be used', async () => {
    render(<TimelineImportPanel />)
    await userEvent.upload(screen.getByLabelText('Timeline export (.json)'), file('{"timelineObjects": []}', 'Semantic.json'))
    expect(await screen.findByRole('alert')).toHaveTextContent(/older Google Takeout location file/)
  })

  it('offers to correct a segment whose time offset was read wrongly before', async () => {
    render(<TimelineImportPanel />)
    await userEvent.upload(screen.getByLabelText('Timeline export (.json)'), file(EXPORT))
    await userEvent.click(await screen.findByRole('button', { name: 'Import 2 segments' }))
    await screen.findByText(/^Imported 2 location segments/)
    const visitRecord = (await db.externalSamples.toArray()).find((sample) => sample.measurementType === 'location_visit')!
    await db.externalSamples.put({ ...visitRecord, startOffsetMinutes: 120 })

    await userEvent.upload(screen.getByLabelText('Timeline export (.json)'), file(EXPORT))
    expect(await screen.findByRole('button', { name: 'Correct 1 segment' })).toBeInTheDocument()
    expect(count('Will be corrected')).toBe('1')
    await userEvent.click(screen.getByRole('button', { name: 'Correct 1 segment' }))
    expect(await screen.findByText(/1 corrected \(time offset\)/)).toBeInTheDocument()
    expect((await db.externalSamples.get(visitRecord.id))?.startOffsetMinutes).toBe(60)
  })
})
