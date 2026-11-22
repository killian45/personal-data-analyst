import { useEffect, useId, useMemo, useRef, useState } from 'react'

import { numbersNotGiven, tidySummary } from '../../ai/check'
import { listModels, OllamaUnavailableError, PREFERRED_MODEL, writeWithOllama } from '../../ai/ollama'
import { buildSummaryFacts, summaryInstructions, summaryPrompt } from '../../ai/summaryFacts'
import type { Measure } from '../../analysis/measures'
import type { DateRange } from '../../stats/delta'
import { messages } from '../../i18n'

/**
 * Local AI summary (Phase 6 step 5): a small model running in Ollama on
 * this computer rewrites the app's own statistics sentences into a short
 * text. Nothing leaves the computer; nothing is stored. The app always
 * shows its own caution and the numbers given, and flags numbers in the
 * text that were not given.
 */

type Availability = { state: 'checking' } | { state: 'unavailable' } | { state: 'ready'; models: string[] }

const buttonClass = 'rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-slate-100 disabled:opacity-50'

export function AiSummaryPanel({ measures, range }: { measures: readonly Measure[]; range: DateRange }) {
  const t = messages().aiSummary
  const id = useId()
  const [availability, setAvailability] = useState<Availability>({ state: 'checking' })
  const [model, setModel] = useState('')
  const [text, setText] = useState('')
  const [writing, setWriting] = useState(false)
  const [error, setError] = useState('')
  const [writtenFor, setWrittenFor] = useState<string[] | null>(null)
  const abort = useRef<AbortController | null>(null)

  const { facts } = useMemo(() => buildSummaryFacts(measures, range), [measures, range])

  useEffect(() => {
    let cancelled = false
    listModels()
      .then((models) => {
        if (cancelled) return
        setAvailability(models.length > 0 ? { state: 'ready', models } : { state: 'unavailable' })
        setModel(models.includes(PREFERRED_MODEL) ? PREFERRED_MODEL : (models[0] ?? ''))
      })
      .catch(() => {
        if (!cancelled) setAvailability({ state: 'unavailable' })
      })
    return () => {
      cancelled = true
      abort.current?.abort()
    }
  }, [])

  async function write() {
    setError('')
    setText('')
    setWrittenFor(null)
    setWriting(true)
    const controller = new AbortController()
    abort.current = controller
    try {
      const result = await writeWithOllama({
        model,
        instructions: summaryInstructions(),
        prompt: summaryPrompt(facts),
        signal: controller.signal,
        onText: setText,
      })
      setText(tidySummary(result))
      setWrittenFor(facts)
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') {
        setText('')
      } else {
        setError(caught instanceof OllamaUnavailableError ? caught.message : caught instanceof Error ? caught.message : t.writeFailed)
      }
    } finally {
      setWriting(false)
      abort.current = null
    }
  }

  if (availability.state === 'checking') return null

  if (availability.state === 'unavailable') {
    return (
      <p className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-3 text-xs text-slate-500">
        {t.unavailable}
      </p>
    )
  }

  const unknownNumbers = writtenFor ? numbersNotGiven(text, writtenFor) : []
  const enough = facts.length > 1

  return (
    <section aria-labelledby={`${id}-title`} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={`${id}-title`} className="text-lg font-semibold">{t.title}</h3>
        <label className="flex items-center gap-2 text-xs">
          <span className="font-medium text-slate-600">{t.model}</span>
          <select value={model} onChange={(event) => setModel(event.target.value)} disabled={writing} className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm">
            {availability.models.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
      </div>
      <p className="text-xs text-slate-500">
        {t.intro}
      </p>

      <details className="rounded-lg border border-slate-200 text-sm">
        <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-slate-600">{t.whatItReceives(facts.length)}</summary>
        <ul className="list-disc space-y-0.5 px-8 pb-3 text-xs text-slate-700">
          {facts.map((fact) => <li key={fact}>{fact}</li>)}
        </ul>
      </details>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={writing || !enough || model === ''}
          onClick={() => void write()}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {writing ? t.writing : t.write}
        </button>
        {writing && <button type="button" className={buttonClass} onClick={() => abort.current?.abort()}>{messages().common.cancel}</button>}
      </div>
      {!enough && <p className="text-xs text-slate-500">{t.notEnough}</p>}

      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {text && (
        <div className="space-y-2">
          <p className="whitespace-pre-line rounded-lg bg-slate-50 p-3 text-sm" aria-live="polite">{text}</p>
          {writtenFor && unknownNumbers.length > 0 && (
            <p role="alert" className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
              {t.unknownNumbers(unknownNumbers)}
            </p>
          )}
          {writtenFor && (
            <p className="text-xs text-slate-500">
              {t.caution}
            </p>
          )}
        </div>
      )}
    </section>
  )
}
