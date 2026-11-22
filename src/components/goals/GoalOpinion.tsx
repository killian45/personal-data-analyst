import { useEffect, useRef, useState } from 'react'

import { numbersNotGiven } from '../../ai/check'
import { chatWithOllama, OllamaUnavailableError } from '../../ai/ollama'
import type { Measure } from '../../analysis/measures'
import type { Goal, GoalsProfile } from '../../goals/goals'
import { buildOpinionFacts, loadOpinions, OPINION_NUM_CTX, opinionInstructions, opinionPrompt, parseOpinion, saveOpinion } from '../../goals/opinion'
import type { StoredOpinion } from '../../goals/opinion'
import { formatInTimezone, getDeviceTimezone } from '../../time/time'
import { messages } from '../../i18n'

/**
 * The local AI's opinion of a goal's likelihood (docs/GOALS_PLAN.md
 * step 3), next to the data figure. Computer only; kept in this
 * computer's storage.
 */

const small = 'rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-slate-100 disabled:opacity-50'

interface GoalOpinionProps {
  goal: Goal
  measures: readonly Measure[]
  profile: GoalsProfile
  today: string
  model: string
}

export function GoalOpinion({ goal, measures, profile, today, model }: GoalOpinionProps) {
  const t = messages()
  const o = t.goals.opinion
  const [opinion, setOpinion] = useState<StoredOpinion | null>(() => loadOpinions()[goal.id] ?? null)
  const [writing, setWriting] = useState<string | null>(null)
  const [error, setError] = useState('')
  const abort = useRef<AbortController | null>(null)

  useEffect(() => () => abort.current?.abort(), [])

  async function ask() {
    setError('')
    setWriting('')
    const controller = new AbortController()
    abort.current = controller
    const facts = buildOpinionFacts({ goal, measures, profile, today })
    try {
      const reply = await chatWithOllama({
        model,
        numCtx: OPINION_NUM_CTX,
        temperature: 0.3,
        signal: controller.signal,
        onText: setWriting,
        messages: [
          { role: 'system', content: opinionInstructions(profile) },
          { role: 'user', content: opinionPrompt(facts) },
        ],
      })
      const next: StoredOpinion = { ...parseOpinion(reply), facts, model, at: new Date().toISOString() }
      setOpinion(next)
      try {
        saveOpinion(goal.id, next)
      } catch (caught) {
        console.error('Could not save the opinion:', caught)
        setError(o.saveFailed)
      }
    } catch (caught) {
      if (!(caught instanceof DOMException && caught.name === 'AbortError')) {
        setError(caught instanceof OllamaUnavailableError ? caught.message : caught instanceof Error ? caught.message : o.aiFailed)
      }
    } finally {
      setWriting(null)
      abort.current = null
    }
  }

  const unknown = opinion ? numbersNotGiven(opinion.text, opinion.facts) : []

  return (
    <div className="space-y-2 rounded-lg border border-slate-200 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-slate-600">{o.title}</span>
        {writing === null ? (
          <button type="button" className={small} disabled={model === ''} onClick={() => void ask()}>
            {opinion ? o.askAgain : o.ask}
          </button>
        ) : (
          <>
            <span className="text-xs text-slate-500">{o.thinking}</span>
            <button type="button" className={small} onClick={() => abort.current?.abort()}>{t.common.cancel}</button>
          </>
        )}
      </div>

      {writing !== null && writing !== '' && <p className="whitespace-pre-line text-slate-600" aria-live="polite">{writing}</p>}
      {error && <p role="alert" className="rounded-lg bg-red-50 p-2 text-xs text-red-700">{error}</p>}

      {opinion && writing === null && (
        <div className="space-y-1">
          <p>
            <span className="font-medium">{o.likelihood(opinion.likelihood ? o.likelihoods[opinion.likelihood] : null)}</span>
          </p>
          {opinion.text && <p className="whitespace-pre-line">{opinion.text}</p>}
          {unknown.length > 0 && (
            <p className="text-xs text-amber-800">{o.notFound(unknown.join(', '))}</p>
          )}
          <p className="text-xs text-slate-500">
            {o.caution(opinion.model, formatInTimezone(opinion.at, getDeviceTimezone(), 'dd/MM/yyyy HH:mm'))}
          </p>
          <details className="text-xs">
            <summary className="cursor-pointer text-slate-600">{o.whatItReceived}</summary>
            <ul className="list-disc space-y-0.5 pl-5 pt-1 text-slate-700">
              {opinion.facts.map((fact) => <li key={fact}>{fact}</li>)}
            </ul>
          </details>
        </div>
      )}
    </div>
  )
}
