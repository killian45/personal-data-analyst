import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from '../App'
import { db } from '../database/db'
import { buildMeasures } from '../analysis/measures'
import { LANGUAGE_STORAGE_KEY } from '../i18n'
import { getFeatures, NEW_PERSON_FEATURES, setFeatures } from '../settings/features'
import { isWelcomeDone, WELCOME_DONE_KEY } from '../settings/welcome'

import { WelcomeScreen } from './WelcomeScreen'

describe('welcome screen (sharing plan S4)', () => {
  beforeEach(async () => {
    localStorage.removeItem(WELCOME_DONE_KEY)
    await db.delete()
    await db.open()
  })

  afterEach(async () => {
    cleanup()
    localStorage.removeItem(LANGUAGE_STORAGE_KEY)
    db.close()
    await db.delete()
  })

  it('walks through the four steps and saves the choices only at the end', async () => {
    const onDone = vi.fn()
    render(<WelcomeScreen database={db} onDone={onDone} restart={() => {}} />)

    expect(screen.getByText('Step 1 of 4')).toBeInTheDocument()
    expect(screen.getByText(/Times are recorded in this device's timezone/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))

    // Step 2: CRM proposed on, the personal features off; turn Goals on.
    expect(screen.getByRole('checkbox', { name: 'Use Personal CRM' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Use Spending (YNAB)' })).not.toBeChecked()
    await userEvent.click(screen.getByRole('checkbox', { name: 'Use Goals and local AI' }))
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))

    // Step 3: on this device only by default.
    expect(screen.getByRole('radio', { name: /On this device only/ })).toBeChecked()
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))

    // Step 4: the tour; nothing saved yet.
    expect(screen.getByRole('heading', { name: 'Data Logging' })).toBeInTheDocument()
    expect(isWelcomeDone()).toBe(false)
    for (let card = 1; card < 4; card++) await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByRole('heading', { name: 'Settings & Data' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Start' }))

    expect(onDone).toHaveBeenCalledOnce()
    expect(isWelcomeDone()).toBe(true)
    expect(getFeatures()).toEqual({ ...NEW_PERSON_FEATURES, goals: true })
  })

  it('the tour can be skipped', async () => {
    const onDone = vi.fn()
    render(<WelcomeScreen database={db} onDone={onDone} restart={() => {}} />)
    for (let step = 1; step < 4; step++) await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    await userEvent.click(screen.getByRole('button', { name: 'Skip the tour' }))
    expect(onDone).toHaveBeenCalledOnce()
    expect(getFeatures()).toEqual(NEW_PERSON_FEATURES)
  })

  it('choosing another language saves it and restarts the app', async () => {
    const restart = vi.fn()
    render(<WelcomeScreen database={db} onDone={() => {}} restart={restart} />)
    await userEvent.selectOptions(screen.getByLabelText('Language'), 'fr')
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('fr')
    expect(restart).toHaveBeenCalledOnce()
  })

  it('choosing "my own server" shows the server form', async () => {
    render(<WelcomeScreen database={db} onDone={() => {}} restart={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    await userEvent.click(screen.getByRole('radio', { name: /Sync between my devices with my own server/ }))
    expect(screen.getByText('Sync server')).toBeInTheDocument()
  })

  it('the app shows the welcome screen on an empty device, then the app', async () => {
    render(<App />)
    expect(await screen.findByText('Welcome to Personal Data Analyst')).toBeInTheDocument()
    for (let step = 1; step < 4; step++) await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    await userEvent.click(screen.getByRole('button', { name: 'Skip the tour' }))
    expect(await screen.findByRole('heading', { name: 'Your habits' })).toBeInTheDocument()
    // New person: CRM in the menu, Goals not.
    expect(screen.getByRole('button', { name: 'CRM' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Goals' })).not.toBeInTheDocument()
  })
})

describe('features that are off (sharing plan S4)', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(async () => {
    cleanup()
    db.close()
    await db.delete()
  })

  it('hide their page and their import panels; Settings can turn them on again', async () => {
    setFeatures({ goals: false, ynab: false, location: false, screenTime: false })
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Your habits' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Goals' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Settings & Data' }))
    expect(await screen.findByRole('heading', { name: 'Features' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'YNAB (budget)' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Import location history (Google Timeline)' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Import screen time (App Usage files)' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('checkbox', { name: 'Use Goals and local AI' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Use Spending (YNAB)' }))
    expect(screen.getByRole('button', { name: 'Goals' })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'YNAB (budget)' })).toBeInTheDocument()
  })

  it('give no Analysis measures, but their data is kept', () => {
    const data = {
      habits: [],
      entries: [],
      sleep: { nights: [], naps: [], excluded: [] },
      screenTime: [],
      location: [],
      placeNames: {},
      displayTimezone: 'event' as const,
      ynab: [
        {
          id: 't1', source: 'ynab', measurementType: 'ynab_transaction', value: -1250, unit: 'milliunits',
          startUtc: '2026-11-20T12:00:00.000Z', endUtc: '2026-11-20T12:00:00.000Z',
          metadata: { localDate: '2026-11-20', category: 'Food', currency: 'EUR' },
        },
      ],
    } as unknown as Parameters<typeof buildMeasures>[0]
    setFeatures({ ynab: false })
    expect(buildMeasures(data).some((measure) => measure.id === 'ynab:spending')).toBe(false)
    setFeatures({ ynab: true })
    expect(buildMeasures(data).some((measure) => measure.id === 'ynab:spending')).toBe(true)
  })
})
