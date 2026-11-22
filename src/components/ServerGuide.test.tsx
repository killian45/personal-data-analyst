import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import setupSql from '../../supabase/setup.sql?raw'
import signInTemplate from '../../supabase/templates/sign-in-code.html?raw'
import { db } from '../database/db'
import { en } from '../i18n/en'
import { fr } from '../i18n/fr'
import { setLanguage } from '../i18n'
import { SyncServerSettings } from './SyncServerSettings'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

afterEach(async () => {
  cleanup()
  setLanguage('en')
  vi.unstubAllGlobals()
  db.close()
  await db.delete()
})

async function openGuide() {
  render(<SyncServerSettings database={db} restart={() => {}} />)
  await userEvent.click(await screen.findByText(/How to set up your own server|Comment installer votre propre serveur/))
}

describe('server guide (sharing plan S5)', () => {
  it('the English sign-in email is the template used by the local test server', () => {
    expect(en.serverGuide.emailBody).toBe(signInTemplate)
    expect(fr.serverGuide.emailBody).toContain('{{ .Token }}')
  })

  it('opens from the server form and lists the steps in order', async () => {
    await openGuide()
    expect(await screen.findByText('Create a free Supabase account')).toBeInTheDocument()
    const titles = ['Create a project in Europe', 'Install the sync tables', 'Set up the sign-in email', 'Create your account on your server', 'Copy two values', 'Connect the app']
    const positions = titles.map((title) => document.body.textContent?.indexOf(title) ?? -1)
    expect(positions.every((position) => position >= 0)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
    expect(screen.getByText(/Free projects are paused/)).toBeInTheDocument()
  })

  it('copies the whole setup file', async () => {
    const writeText = vi.fn(async () => {})
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    await openGuide()
    await userEvent.click(await screen.findByRole('button', { name: 'Copy the setup file' }))
    expect(writeText).toHaveBeenCalledOnce()
    const copied = writeText.mock.calls[0] as unknown as [string]
    expect(copied[0]).toContain('create table public.user_keys')
    expect(copied[0]).toBe(setupSql)
    expect(await screen.findByText('Copied.')).toBeInTheDocument()
  })

  it('shows the text to copy by hand when copying is not possible', async () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: undefined })
    await openGuide()
    await userEvent.click(await screen.findByRole('button', { name: 'Copy the content' }))
    expect(await screen.findByText(/select the text below and copy it/)).toBeInTheDocument()
    expect(screen.getByDisplayValue(/Enter this code in the app to sign in/)).toBeVisible()
  })

  it('is in French when the app is in French, with a French email', async () => {
    setLanguage('fr')
    await openGuide()
    expect(await screen.findByText('Installer les tables de synchronisation')).toBeInTheDocument()
    await userEvent.click(screen.getAllByText('Afficher le texte')[2])
    expect(screen.getByDisplayValue(/Saisissez ce code dans l'application/)).toBeInTheDocument()
  })
})
