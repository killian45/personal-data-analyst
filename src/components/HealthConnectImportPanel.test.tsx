import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { db } from '../database/db'
import { buildHealthConnectDb } from '../import/testHealthConnect'
import { buildZip } from '../import/testZip'

import { HealthConnectImportPanel } from './HealthConnectImportPanel'

const NIGHT = {
  start: '2026-11-08T22:00:00.000Z',
  end: '2026-11-09T06:00:00.000Z',
  stages: [{ start: '2026-11-08T22:10:00.000Z', end: '2026-11-09T05:50:00.000Z', type: 2 }],
}

async function exportFile(sessions = [NIGHT, { ...NIGHT, start: '2026-11-09T22:00:00.000Z', end: '2026-11-10T06:00:00.000Z' }]) {
  const zip = await buildZip(
    [{ name: 'health_connect_export.db', content: await buildHealthConnectDb(sessions, { otherCounts: { steps_record_table: 4 } }), deflate: true }],
    { dataDescriptor: true },
  )
  return new File([zip as BlobPart], 'Health Connect.zip', { type: 'application/zip' })
}

describe('HealthConnectImportPanel', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(async () => {
    cleanup()
    db.close()
    await db.delete()
  })

  it('previews an export, then imports it after confirmation', async () => {
    const onImported = vi.fn()

    render(<HealthConnectImportPanel onImported={onImported} />)

    await userEvent.upload(screen.getByLabelText('Health Connect export (.zip)'), await exportFile())

    expect(await screen.findByText(/2 sleep sessions found/)).toBeInTheDocument()
    const willImport = screen.getByRole('rowheader', { name: 'Will be imported' }).closest('tr') as HTMLElement
    expect(within(willImport).getByText('2')).toBeInTheDocument()
    expect(screen.getByText(/steps \(4\)/)).toBeInTheDocument()
    expect(await db.sleepSessions.count()).toBe(0)

    await userEvent.click(screen.getByRole('button', { name: 'Import 2 sleep sessions' }))

    expect(await screen.findByText('Imported 2 sleep sessions.')).toBeInTheDocument()
    expect(await db.sleepSessions.count()).toBe(2)
    expect(onImported).toHaveBeenCalledOnce()
  })

  it('reports duplicates when the same export is imported again', async () => {
    render(<HealthConnectImportPanel />)

    const file = await exportFile()
    await userEvent.upload(screen.getByLabelText('Health Connect export (.zip)'), file)
    await userEvent.click(await screen.findByRole('button', { name: 'Import 2 sleep sessions' }))
    await screen.findByText('Imported 2 sleep sessions.')

    await userEvent.upload(screen.getByLabelText('Health Connect export (.zip)'), file)

    expect(await screen.findByText('Nothing new to import.')).toBeInTheDocument()
    expect(screen.getByText('Skipped duplicates (2)')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Import \d/ })).not.toBeInTheDocument()
  })

  it('explains files that cannot be read', async () => {
    render(<HealthConnectImportPanel />)

    await userEvent.upload(
      screen.getByLabelText('Health Connect export (.zip)'),
      new File(['not a zip'], 'notes.zip', { type: 'application/zip' }),
    )

    expect(await screen.findByRole('alert')).toHaveTextContent('This file is not a valid zip archive, or it is damaged.')
  })
})
