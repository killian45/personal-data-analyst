import { Capacitor } from '@capacitor/core'
import { useEffect, useState } from 'react'

import { listModels, PREFERRED_MODEL } from '../ai/ollama'
import { buildMeasures } from '../analysis/measures'
import type { Measure } from '../analysis/measures'
import { GoalCard } from '../components/goals/GoalCard'
import { GoalForm } from '../components/goals/GoalForm'
import { GoalsChat } from '../components/goals/GoalsChat'
import { ProfileForm } from '../components/goals/ProfileForm'
import { PageHeading } from '../components/layout/PageHeading'
import { loadDashboardData } from '../dashboard/loadDashboardData'
import { goalProgress } from '../goals/goals'
import type { Goal, GoalsProfile } from '../goals/goals'
import { deleteGoal, loadGoals, loadProfile, saveGoal, saveProfile } from '../goals/goalsStore'
import { saveOpinion } from '../goals/opinion'
import { messages } from '../i18n'
import { formatInTimezone, getDeviceTimezone } from '../time/time'

const primary = 'rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700'
const secondary = 'rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-100'
const ORDER = { 'in-progress': 0, 'not-started': 1, finished: 2 }

function localToday(): string {
  return formatInTimezone(new Date().toISOString(), getDeviceTimezone(), 'yyyy-MM-dd')
}

/** Goals (docs/GOALS_PLAN.md): the AI profile, goals and their progress, and the chat with the local AI (computer only). */
export default function GoalsPage({ dataVersion = 0 }: { dataVersion?: number }) {
  const t = messages().goals
  const [measures, setMeasures] = useState<Measure[] | null>(null)
  const [goals, setGoals] = useState<Goal[]>([])
  const [profile, setProfile] = useState<GoalsProfile | null>(null)
  const [view, setView] = useState<{ kind: 'list' } | { kind: 'profile' } | { kind: 'goal'; goal: Goal | null }>({ kind: 'list' })
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [today] = useState(localToday)
  // The AI's opinions need Ollama on this computer (never on the phone).
  const [aiModel, setAiModel] = useState<string | null>(null)

  useEffect(() => {
    if (Capacitor.isNativePlatform()) return
    let cancelled = false
    listModels()
      .then((models) => {
        if (!cancelled) setAiModel(models.includes(PREFERRED_MODEL) ? PREFERRED_MODEL : (models[0] ?? null))
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    Promise.all([loadDashboardData(), loadGoals(), loadProfile()])
      .then(([data, storedGoals, storedProfile]) => {
        if (cancelled) return
        setMeasures(buildMeasures(data, localToday()))
        setGoals(storedGoals)
        setProfile(storedProfile)
      })
      .catch((caught: unknown) => {
        console.error('Failed to load goals:', caught)
        if (!cancelled) setError(messages().goals.loadFailed)
      })
    return () => {
      cancelled = true
    }
  }, [dataVersion])

  if (error) return <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>
  if (!measures || !profile) return <p className="py-8 text-center text-sm text-slate-500">{t.loading}</p>

  const statusOf = (goal: Goal) => {
    const start = formatInTimezone(goal.startUtc, goal.timezone, 'yyyy-MM-dd')
    const end = formatInTimezone(goal.endUtc, goal.timezone, 'yyyy-MM-dd')
    return goalProgress(goal, { start, end }, [], today).status
  }
  const sorted = [...goals].sort((a, b) => ORDER[statusOf(a)] - ORDER[statusOf(b)] || a.endUtc.localeCompare(b.endUtc))

  return (
    <section className="space-y-6">
      <PageHeading title={t.title} description={t.description} />

      {status && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{status}</p>}

      {view.kind === 'profile' ? (
        <ProfileForm
          profile={profile}
          onClose={() => setView({ kind: 'list' })}
          onSave={async (next) => {
            setProfile(await saveProfile(next))
            setView({ kind: 'list' })
            setStatus(t.profileSaved)
          }}
        />
      ) : view.kind === 'goal' ? (
        <GoalForm
          measures={measures}
          goal={view.goal}
          onCancel={() => setView({ kind: 'list' })}
          onSave={async (goal) => {
            setGoals(await saveGoal(goal))
            setView({ kind: 'list' })
            setStatus(view.goal ? t.goalSaved : t.goalAdded)
          }}
        />
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => { setStatus(''); setView({ kind: 'goal', goal: null }) }} className={primary}>{t.addGoal}</button>
            <button type="button" onClick={() => { setStatus(''); setView({ kind: 'profile' }) }} className={secondary}>{t.setUpAi}</button>
          </div>
          {sorted.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-8 text-center text-sm text-slate-500">
              {t.noGoals}
            </p>
          ) : (
            sorted.map((goal) => (
              <GoalCard
                key={goal.id}
                goal={goal}
                measures={measures}
                today={today}
                profile={profile}
                aiModel={aiModel}
                onEdit={() => { setStatus(''); setView({ kind: 'goal', goal }) }}
                onDelete={async () => {
                  setGoals(await deleteGoal(goal.id))
                  try {
                    saveOpinion(goal.id, null)
                  } catch {
                    // Storage unavailable: nothing to remove.
                  }
                  setStatus(t.goalDeleted(goal.title))
                }}
              />
            ))
          )}
          {Capacitor.isNativePlatform() ? (
            <p className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-3 text-xs text-slate-500">
              {t.chatComputerOnly}
            </p>
          ) : (
            <GoalsChat measures={measures} goals={goals} profile={profile} today={today} />
          )}
        </>
      )}
    </section>
  )
}
