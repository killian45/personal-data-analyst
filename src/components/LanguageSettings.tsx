import { useId, useState } from 'react'

import {
  deviceLanguage,
  getLanguage,
  LANGUAGE_NAMES,
  LANGUAGES,
  messages,
  saveLanguage,
  savedLanguage,
  UNCHECKED_LANGUAGES,
  type Language,
} from '../i18n'

interface LanguageSettingsProps {
  /** Restarts the app (replaced in tests). */
  restart?: () => void
}

type Choice = Language | 'device'

/**
 * Language of the app on this device (sharing plan S3). Saved in this
 * device's storage; the app restarts to apply it, so every screen and
 * message changes at once.
 */
export function LanguageSettings({ restart = () => window.location.reload() }: LanguageSettingsProps) {
  const t = messages().settings.language
  const id = useId()
  const [initial] = useState<Choice>(() => savedLanguage() ?? 'device')
  const [choice, setChoice] = useState<Choice>(initial)

  const name = (language: Language) =>
    UNCHECKED_LANGUAGES.includes(language) ? t.withNote(LANGUAGE_NAMES[language], t.unchecked) : LANGUAGE_NAMES[language]

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h3 className="text-lg font-semibold">{t.title}</h3>
      <p className="mt-1 text-sm text-slate-500">{t.intro}</p>

      <div className="mt-4 space-y-3">
        <div>
          <label htmlFor={`${id}-language`} className="mb-1 block text-sm font-medium">
            {t.label}
          </label>
          <select
            id={`${id}-language`}
            value={choice}
            onChange={(event) => setChoice(event.target.value as Choice)}
            className="w-full max-w-md rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            <option value="device">{t.automatic(LANGUAGE_NAMES[deviceLanguage()])}</option>
            {LANGUAGES.map((language) => (
              <option key={language} value={language}>
                {name(language)}
              </option>
            ))}
          </select>
        </div>

        <p className="text-xs text-slate-500">
          {t.current(name(getLanguage()))} {t.restartNote}
        </p>

        <button
          type="button"
          disabled={choice === initial}
          onClick={() => {
            saveLanguage(choice === 'device' ? null : choice)
            restart()
          }}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t.save}
        </button>
      </div>
    </section>
  )
}
