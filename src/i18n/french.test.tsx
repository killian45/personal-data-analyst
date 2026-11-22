import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { tidySummary } from '../ai/check'
import { LanguageSettings } from '../components/LanguageSettings'
import { fullPeriodLabel } from '../components/dashboard/periodLabels'
import { parseOpinion } from '../goals/opinion'
import { cleanComment, commentTemplate } from '../logging/commentTemplate'
import { formatInTimezone } from '../time/time'

import { en } from './en'
import { formatNumber } from './formats'
import { fr } from './fr'
import { deviceLanguage, LANGUAGE_STORAGE_KEY, messages, plural, savedLanguage, saveLanguage, setLanguage, startLanguage } from './index'

/** Every string in a catalogue (functions are called with sample values). */
function strings(value: unknown, path = ''): [string, string][] {
  if (typeof value === 'string') return [[path, value]]
  if (typeof value === 'function') return []
  // List items share one path: lists such as the AI's intro words may differ in length between languages.
  if (Array.isArray(value)) return value.flatMap((item) => strings(item, `${path}[]`))
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([key, item]) => strings(item, path ? `${path}.${key}` : key))
  return []
}

afterEach(() => {
  setLanguage('en')
  localStorage.removeItem(LANGUAGE_STORAGE_KEY)
})

describe('French catalogue (sharing plan S3)', () => {
  it('has no empty text and the same keys as English', () => {
    const french = strings(fr)
    expect(french.filter(([, text]) => text.trim() === '')).toEqual([])
    expect([...new Set(french.map(([path]) => path))].sort()).toEqual([...new Set(strings(en).map(([path]) => path))].sort())
  })

  it('translates most texts (only names, units and symbols stay the same)', () => {
    const english = strings(en).filter(([path]) => !path.endsWith('[]'))
    const french = new Map(strings(fr).filter(([path]) => !path.endsWith('[]')))
    const same = english.filter(([path, text]) => french.get(path) === text)
    // e.g. "CRM", "OK", "Health Connect", "Excel (XLSX)", "km"…: a small share.
    expect(same.length / english.length).toBeLessThan(0.12)
  })

  it('uses French plural rules: 0 and 1 are singular', () => {
    setLanguage('fr')
    const forms = { one: 'un', other: 'plusieurs' }
    expect([plural(0, forms), plural(1, forms), plural(2, forms)]).toEqual(['un', 'un', 'plusieurs'])
    expect(messages().crm.count(0)).toBe('0 contact')
  })

  it('formats numbers and month names in French, dates still day/month/year and 24-hour', () => {
    setLanguage('fr')
    expect(formatNumber(1234.567).replace(/\s/g, ' ')).toBe('1 234,57')
    expect(formatInTimezone('2026-11-09T08:00:00.000Z', 'Europe/Paris', 'EEE d MMM yyyy')).toBe('lun. 9 nov. 2026')
    expect(formatInTimezone('2026-09-09T21:30:00.000Z', 'Europe/Paris', 'dd/MM/yyyy HH:mm')).toBe('09/09/2026 23:30')
    expect(fullPeriodLabel('2026-09-07', 'week')).toBe('Semaine du 7 sept. 2026')
  })

  it('asks for the French confirmation words', () => {
    setLanguage('fr')
    expect(messages().common.typeToConfirm(messages().confirmWords.delete)).toBe('Tapez SUPPRIMER pour confirmer')
    expect(Object.values(fr.confirmWords)).toEqual(['SUPPRIMER', 'RETIRER', 'RECOMMENCER'])
  })

  it('opens comment boxes with French prompts and removes empty prompts of both languages', () => {
    setLanguage('fr')
    expect(commentTemplate()).toBe('Pourquoi : \nEn hausse : \nEn baisse : \nProchaine expérience : ')
    expect(cleanComment('Pourquoi : fatigue\nEn hausse : \nWhy:\nNext experiment: marcher')).toBe('Pourquoi : fatigue\nNext experiment: marcher')
  })

  it("reads the AI's likelihood line in French and in English, whatever the app language", () => {
    setLanguage('fr')
    expect(parseOpinion('Probabilité : élevée\nVous êtes régulier.')).toEqual({ likelihood: 'high', text: 'Vous êtes régulier.' })
    expect(parseOpinion('**Probabilité : faible**\nTrop ambitieux.').likelihood).toBe('low')
    expect(parseOpinion('Likelihood: medium\nOk.').likelihood).toBe('medium')
    expect(parseOpinion('Probabilité : élevéement').likelihood).toBeNull()
    expect(tidySummary('Voici votre résumé :\nVous avez bien dormi.')).toBe('Vous avez bien dormi.')
    expect(messages().ai.summary.instructions).toContain('Écris en français')
  })
})

describe('language choice', () => {
  it("follows the device's first known language, English otherwise", () => {
    expect(deviceLanguage(['fr-FR', 'en'])).toBe('fr')
    expect(deviceLanguage(['de-DE', 'fr-CA'])).toBe('fr')
    expect(deviceLanguage(['de-DE'])).toBe('en')
    expect(deviceLanguage([])).toBe('en')
  })

  it('a saved choice wins over the device; null follows the device again', () => {
    saveLanguage('fr')
    expect(savedLanguage()).toBe('fr')
    expect(startLanguage()).toBe('fr')
    saveLanguage(null)
    expect(savedLanguage()).toBeNull()
    localStorage.setItem(LANGUAGE_STORAGE_KEY, 'klingon')
    expect(savedLanguage()).toBeNull()
  })

  it('saves the chosen language and restarts the app', async () => {
    const restart = vi.fn()
    render(<LanguageSettings restart={restart} />)
    const save = screen.getByRole('button', { name: 'Save and restart' })
    expect(save).toBeDisabled()
    await userEvent.selectOptions(screen.getByLabelText('Language'), 'fr')
    await userEvent.click(save)
    expect(savedLanguage()).toBe('fr')
    expect(restart).toHaveBeenCalledOnce()
    expect(screen.getByRole('option', { name: 'Français (machine translation, to be checked by a native speaker)' })).toBeInTheDocument()
  })

  it('shows a screen in French when the language is French', () => {
    setLanguage('fr')
    render(<LanguageSettings restart={() => {}} />)
    expect(screen.getByRole('heading', { name: 'Langue' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Enregistrer et redémarrer' })).toBeInTheDocument()
    expect(document.documentElement.lang).toBe('fr')
  })
})
