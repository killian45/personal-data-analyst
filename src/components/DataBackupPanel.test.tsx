import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import { db } from '../database/db'
import { createHabit } from '../database/habits'

import { DataBackupPanel } from './DataBackupPanel'

describe('DataBackupPanel', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()

    // jsdom does not implement file downloads.
    URL.createObjectURL = vi.fn(() => 'blob:test')
    URL.revokeObjectURL = vi.fn()
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  })

  afterEach(async () => {
    cleanup()
    vi.restoreAllMocks()
    db.close()
    await db.delete()
  })

  it('downloads a backup and reports what it contains', async () => {
    await createHabit({ name: 'Water', type: 'number' })

    render(<DataBackupPanel />)

    await userEvent.click(
      screen.getByRole('button', { name: 'Download backup (JSON)' }),
    )

    expect(
      await screen.findByText(/Backup downloaded\. It contains .*1 habit\b/),
    ).toBeInTheDocument()

    expect(URL.createObjectURL).toHaveBeenCalledOnce()
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledOnce()
  })

  it('shows the storage protection status', async () => {
    render(<DataBackupPanel />)

    // jsdom has no Storage API, so the status is reported as unknown.
    expect(
      await screen.findByText(/does not report whether the data is protected/),
    ).toBeInTheDocument()
  })

  it('explains how to fix a refused persistent storage request in Firefox', async () => {
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: {
        persisted: vi.fn(async () => false),
        persist: vi.fn(async () => false),
        estimate: vi.fn(async () => ({ usage: 1024, quota: 1_000_000 })),
      },
    })

    try {
      render(<DataBackupPanel />)

      await userEvent.click(
        await screen.findByRole('button', {
          name: 'Ask browser to keep data permanently',
        }),
      )

      const message = await screen.findByRole('alert')

      expect(message).toHaveTextContent('The browser refused permanent storage.')
      expect(message).toHaveTextContent('Manage Exceptions')
      expect(message).toHaveTextContent('Ctrl+I → Permissions')
    } finally {
      // Restore jsdom's default (no Storage API) for the other tests.
      delete (navigator as { storage?: unknown }).storage
    }
  })

  it('explains the local storage and backup risks', () => {
    render(<DataBackupPanel />)

    expect(
      screen.getByText(/Backup files contain all your personal data, unencrypted/),
    ).toBeInTheDocument()
  })
})
