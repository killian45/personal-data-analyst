import { useId, useState } from 'react'

import type { PersonalDataDatabase } from '../database/db'
import {
  deviceLanguage,
  getLanguage,
  LANGUAGE_NAMES,
  LANGUAGES,
  messages,
  saveLanguage,
  UNCHECKED_LANGUAGES,
  type Language,
} from '../i18n'
import { NEW_PERSON_FEATURES, setFeatures, type FeatureSwitches } from '../settings/features'
import { isAppleMobile } from '../platform/appleMobile'
import { markWelcomeDone } from '../settings/welcome'
import { deviceReportsTimezone, getDeviceTimezone, saveFallbackTimezone } from '../time/time'

import { FeatureChoices } from './FeaturesPanel'
import { SyncServerSettings } from './SyncServerSettings'
import { TimezoneField } from './TimezoneField'

interface WelcomeScreenProps {
  database: PersonalDataDatabase
  /** Called when the person finishes (the app is shown). */
  onDone: () => void
  /** Restarts the app (language change, new server); replaced in tests. */
  restart?: () => void
}

const STEPS = 4
const primary =
  'rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50'
const secondary = 'rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-100'

/**
 * First launch on an empty device (sharing plan S4): language and
 * timezone, optional features, where the data is kept, and a short tour.
 * Choices are saved on this device when the person finishes (or before a
 * restart for a new language or server).
 */
export function WelcomeScreen({ database, onDone, restart = () => window.location.reload() }: WelcomeScreenProps) {
  const t = messages().welcome
  const id = useId()
  const [step, setStep] = useState(1)
  const [features, setChosenFeatures] = useState<FeatureSwitches>(NEW_PERSON_FEATURES)
  const [server, setServer] = useState<'local' | 'own'>('local')
  const [timezone, setTimezone] = useState(getDeviceTimezone)
  const [tourCard, setTourCard] = useState(0)
  const knowsTimezone = deviceReportsTimezone()

  function saveChoices() {
    setFeatures(features)
    if (!knowsTimezone) saveFallbackTimezone(timezone)
  }

  function finish() {
    saveChoices()
    markWelcomeDone()
    onDone()
  }

  function chooseLanguage(language: Language) {
    if (language === getLanguage()) return
    // Saved now; the welcome screen starts again in the new language.
    saveLanguage(language === deviceLanguage() ? null : language)
    restart()
  }

  const languageName = (language: Language) =>
    UNCHECKED_LANGUAGES.includes(language)
      ? messages().settings.language.withNote(LANGUAGE_NAMES[language], messages().settings.language.unchecked)
      : LANGUAGE_NAMES[language]

  const tour = t.tour[tourCard]

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10 text-slate-900">
      <section aria-labelledby={`${id}-title`} className="mx-auto max-w-xl space-y-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div>
          <p className="text-xs font-medium text-slate-500">{t.stepOf(step, STEPS)}</p>
          <h1 id={`${id}-title`} className="text-2xl font-bold">{t.title}</h1>
        </div>

        {step === 1 && (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">{t.privacy}</p>
            <h2 className="text-lg font-semibold">{t.languageTitle}</h2>
            <div>
              <label htmlFor={`${id}-language`} className="mb-1 block text-sm font-medium">
                {messages().settings.language.label}
              </label>
              <select
                id={`${id}-language`}
                value={getLanguage()}
                onChange={(event) => chooseLanguage(event.target.value as Language)}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                {LANGUAGES.map((language) => (
                  <option key={language} value={language}>
                    {languageName(language)}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-slate-500">{t.languageChanged}</p>
            </div>
            {knowsTimezone ? (
              <p className="text-sm text-slate-600">{t.timezone(timezone)}</p>
            ) : (
              <div>
                <p className="mb-2 text-sm text-slate-600">{t.timezoneUnknown}</p>
                <TimezoneField id={`${id}-timezone`} value={timezone} onChange={setTimezone} />
              </div>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">{t.featuresTitle}</h2>
            <p className="text-sm text-slate-600">{t.featuresIntro}</p>
            <FeatureChoices value={features} onChange={(feature, on) => setChosenFeatures({ ...features, [feature]: on })} />
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">{t.serverTitle}</h2>
            <fieldset className="space-y-3">
              <legend className="sr-only">{t.serverTitle}</legend>
              <label className="flex cursor-pointer items-start gap-3 text-sm">
                <input type="radio" name={`${id}-server`} className="mt-1" checked={server === 'local'} onChange={() => setServer('local')} />
                <span>
                  <span className="font-medium">{t.localOnly}</span>
                  <span className="block text-xs text-slate-500">{t.localOnlyHelp}</span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-3 text-sm">
                <input type="radio" name={`${id}-server`} className="mt-1" checked={server === 'own'} onChange={() => setServer('own')} />
                <span>
                  <span className="font-medium">{t.ownServer}</span>
                  <span className="block text-xs text-slate-500">{t.ownServerHelp}</span>
                </span>
              </label>
            </fieldset>
            {isAppleMobile() && <p role="note" className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">{messages().install.iphoneLimits}</p>}
            {server === 'own' && (
              <SyncServerSettings
                database={database}
                restart={() => {
                  // The choices are kept: the app restarts with the new server, already set up.
                  saveChoices()
                  markWelcomeDone()
                  restart()
                }}
              />
            )}
          </div>
        )}

        {step === 4 && tour && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">{t.tourTitle}</h2>
            <div className="rounded-xl bg-slate-50 p-4" aria-live="polite">
              <p className="text-xs text-slate-500">{t.stepOf(tourCard + 1, t.tour.length)}</p>
              <h3 className="font-semibold">{tour.title}</h3>
              <p className="mt-1 text-sm text-slate-600">{tour.text}</p>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {(step > 1 || tourCard > 0) && (
            <button
              type="button"
              className={secondary}
              onClick={() => (step === 4 && tourCard > 0 ? setTourCard(tourCard - 1) : setStep(step - 1))}
            >
              {t.back}
            </button>
          )}
          {step < 4 && (
            <button type="button" className={primary} onClick={() => setStep(step + 1)}>
              {t.next}
            </button>
          )}
          {step === 4 && tourCard < t.tour.length - 1 && (
            <>
              <button type="button" className={primary} onClick={() => setTourCard(tourCard + 1)}>
                {t.next}
              </button>
              <button type="button" className={secondary} onClick={finish}>
                {t.skip}
              </button>
            </>
          )}
          {step === 4 && tourCard === t.tour.length - 1 && (
            <button type="button" className={primary} onClick={finish}>
              {t.start}
            </button>
          )}
        </div>
      </section>
    </main>
  )
}
