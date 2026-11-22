import { useEffect, useId, useMemo, useRef, useState } from 'react'

import { numbersNotGiven, tidySummary } from '../../ai/check'
import { chatWithOllama, listModels, OllamaUnavailableError, PREFERRED_MODEL } from '../../ai/ollama'
import type { Measure } from '../../analysis/measures'
import { buildChatContext, CHAT_NUM_CTX, fitConversation } from '../../goals/chatContext'
import { clearChat, loadChat, saveChat } from '../../goals/chatStore'
import type { StoredChatMessage } from '../../goals/chatStore'
import type { Goal, GoalsProfile } from '../../goals/goals'
import { formatInTimezone, getDeviceTimezone } from '../../time/time'
// Imported under another name: "messages" is this chat's conversation.
import { messages as appTexts } from '../../i18n'

/**
 * Chat with the local AI about goals (docs/GOALS_PLAN.md step 2), on the
 * computer only. The model (Ollama on 127.0.0.1) receives the context
 * built by buildChatContext — summaries only — plus the recent messages.
 * The conversation is kept in this computer's storage only.
 */

type Availability = { state: 'checking' } | { state: 'unavailable' } | { state: 'ready'; models: string[] }

/** The current time (read when sending, never while drawing). */
function nowIso(): string {
  return new Date().toISOString()
}

const small = 'rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-slate-100 disabled:opacity-50'

interface GoalsChatProps {
  measures: readonly Measure[]
  goals: readonly Goal[]
  profile: GoalsProfile
  today: string
}

export function GoalsChat({ measures, goals, profile, today }: GoalsChatProps) {
  const t = appTexts()
  const c = t.goals.chat
  const id = useId()
  const [availability, setAvailability] = useState<Availability>({ state: 'checking' })
  const [model, setModel] = useState('')
  const [messages, setMessages] = useState<StoredChatMessage[]>(loadChat)
  const [input, setInput] = useState('')
  const [reply, setReply] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [confirmClear, setConfirmClear] = useState(false)
  const abort = useRef<AbortController | null>(null)

  const context = useMemo(() => buildChatContext({ profile, goals, measures, today }), [profile, goals, measures, today])
  const dropped = fitConversation(messages, context.system).dropped
  const writing = reply !== null

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

  async function send() {
    const text = input.trim()
    if (!text || writing) return
    setError('')
    setConfirmClear(false)
    const before = messages
    const withQuestion = [...before, { role: 'user' as const, content: text, at: nowIso() }]
    setMessages(withQuestion)
    setInput('')
    setReply('')
    const controller = new AbortController()
    abort.current = controller
    try {
      const { kept } = fitConversation(withQuestion, context.system)
      const answer = await chatWithOllama({
        model,
        numCtx: CHAT_NUM_CTX,
        temperature: 0.4,
        // Keeps the context Ollama has read, so the next reply starts sooner.
        keepAlive: '10m',
        signal: controller.signal,
        onText: setReply,
        messages: [{ role: 'system', content: context.system }, ...kept.map(({ role, content }) => ({ role, content }))],
      })
      const finished = [...withQuestion, { role: 'assistant' as const, content: tidySummary(answer) || c.noAnswer, at: nowIso() }]
      setMessages(finished)
      try {
        saveChat(finished)
      } catch (caught) {
        console.error('Could not save the chat:', caught)
        setError(c.saveFailed)
      }
    } catch (caught) {
      // Cancelled or failed: the question goes back into the box, nothing is saved.
      setMessages(before)
      setInput(text)
      if (!(caught instanceof DOMException && caught.name === 'AbortError')) {
        setError(caught instanceof OllamaUnavailableError ? caught.message : caught instanceof Error ? caught.message : c.aiFailed)
      }
    } finally {
      setReply(null)
      abort.current = null
    }
  }

  if (availability.state === 'checking') return null

  if (availability.state === 'unavailable') {
    return (
      <p className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-3 text-xs text-slate-500">
        {c.unavailable}
      </p>
    )
  }

  const said = [context.system, ...messages.filter((message) => message.role === 'user').map((message) => message.content)]
  const time = (utc: string) => formatInTimezone(utc, getDeviceTimezone(), 'dd/MM/yyyy HH:mm')

  return (
    <section aria-labelledby={`${id}-title`} className="space-y-3 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={`${id}-title`} className="text-lg font-semibold">{c.title}</h3>
        <label className="flex items-center gap-2 text-xs">
          <span className="font-medium text-slate-600">{c.model}</span>
          <select value={model} onChange={(event) => setModel(event.target.value)} disabled={writing} className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm">
            {availability.models.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
      </div>
      <p className="text-xs text-slate-500">
        {c.intro}
      </p>

      <details className="rounded-lg border border-slate-200 text-sm">
        <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-slate-600">{c.whatItReceives}</summary>
        <div className="space-y-2 px-3 pb-3 text-xs text-slate-700">
          {context.shortened && <p className="text-amber-800">{c.shortened}</p>}
          {context.sections.map((section) => (
            <div key={section.title}>
              <p className="font-medium">{section.title}</p>
              <ul className="list-disc space-y-0.5 pl-5">
                {section.lines.map((line) => <li key={line} className="whitespace-pre-line">{line}</li>)}
              </ul>
            </div>
          ))}
          <p>{c.plusRecent}</p>
        </div>
      </details>

      {messages.length > 0 && (
        <ol aria-label={c.conversation} className="space-y-2">
          {dropped > 0 && (
            <li className="text-xs text-slate-500">{c.dropped(dropped)}</li>
          )}
          {messages.map((message, index) => {
            const unknown = message.role === 'assistant' ? numbersNotGiven(message.content, said) : []
            return (
              <li key={`${message.at}-${index}`} className={message.role === 'user' ? 'ml-8 rounded-lg bg-blue-50 p-3 text-sm' : 'mr-8 rounded-lg bg-slate-50 p-3 text-sm'}>
                <p className="text-xs font-medium text-slate-500">{message.role === 'user' ? c.you : c.ai} · {time(message.at)}</p>
                <p className="whitespace-pre-line">{message.content}</p>
                {unknown.length > 0 && (
                  <p className="mt-1 text-xs text-amber-800">
                    {c.notFound(unknown.join(', '), unknown.length)}
                  </p>
                )}
              </li>
            )
          })}
          {writing && (
            <li className="mr-8 rounded-lg bg-slate-50 p-3 text-sm" aria-live="polite">
              <p className="text-xs font-medium text-slate-500">{c.ai}</p>
              <p className="whitespace-pre-line">{reply || c.reading}</p>
            </li>
          )}
        </ol>
      )}

      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <form
        className="space-y-2"
        onSubmit={(event) => {
          event.preventDefault()
          void send()
        }}
      >
        <label className="block text-sm font-medium" htmlFor={`${id}-input`}>{c.yourMessage}</label>
        <textarea
          id={`${id}-input`}
          value={input}
          rows={3}
          maxLength={2000}
          disabled={writing}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              void send()
            }
          }}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" disabled={writing || input.trim() === '' || model === ''} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">
            {writing ? c.answering : c.send}
          </button>
          {writing && <button type="button" className={small} onClick={() => abort.current?.abort()}>{t.common.cancel}</button>}
          <span className="text-xs text-slate-500">{c.enterHint}</span>
          {messages.length > 0 && !writing && (
            confirmClear ? (
              <>
                <button type="button" className={`${small} border-red-200 text-red-700`} onClick={() => { clearChat(); setMessages([]); setConfirmClear(false) }}>{c.confirmClear}</button>
                <button type="button" className={small} onClick={() => setConfirmClear(false)}>{c.keepIt}</button>
              </>
            ) : (
              <button type="button" className={`${small} ml-auto`} onClick={() => setConfirmClear(true)}>{c.clear}</button>
            )
          )}
        </div>
      </form>
      <p className="text-xs text-slate-500">{c.caution}</p>
    </section>
  )
}
