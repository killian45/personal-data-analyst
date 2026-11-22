import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import App from './App'
import { db } from './database/db'
import { createEntry } from './database/entries'
import { createHabit } from './database/habits'
import { setLanguage } from './i18n'

/**
 * The whole app in French (sharing plan S3): every page opens and shows
 * French texts, with a little made-up data.
 */
describe('App in French', () => {
  beforeEach(async () => {
    setLanguage('fr')
    await db.delete()
    await db.open()
  })

  afterEach(async () => {
    cleanup()
    setLanguage('en')
    db.close()
    await db.delete()
  })

  it('opens every page in French', async () => {
    const habit = await createHabit({ name: 'Eau', type: 'number', unit: 'ml' })
    await createEntry({ habitId: habit.id, value: 750, occurredStart: '2026-11-20T08:00:00.000Z', timezone: 'Europe/Paris' })

    render(<App />)

    // Saisie (start page)
    expect(await screen.findByLabelText('Valeur pour Eau')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Vos habitudes' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Journal des données' }))
    expect(await screen.findByText('1–1 sur 1 saisie')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /Habitude/ })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Tableau de bord' }))
    expect(await screen.findByRole('button', { name: '30 jours' })).toBeInTheDocument()
    expect(screen.getByText('Regrouper par')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Analyse' }))
    expect(await screen.findByText(/Il faut au moins deux mesures avec des données/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Objectifs' }))
    expect(await screen.findByRole('button', { name: 'Ajouter un objectif' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'CRM' }))
    expect(await screen.findByRole('button', { name: 'Nouveau contact' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Réglages et données' }))
    expect(await screen.findByRole('heading', { name: 'Réglages et données' })).toBeInTheDocument()
    expect(screen.getByText("Réglages d'affichage")).toBeInTheDocument()

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    // It walks through seven pages: more time than the default when the machine is busy.
  }, 30_000)
})
