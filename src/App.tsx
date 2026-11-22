import { lazy, Suspense, useEffect, useState, useSyncExternalStore } from 'react'
import type { DragEvent, FormEvent } from 'react'

import { Capacitor } from '@capacitor/core'

import { HabitCard } from './components/habits/HabitCard'
import { HabitForm } from './components/habits/HabitForm'
import { INITIAL_FORM } from './components/habits/habitTypes'
import { NavigationButton } from './components/layout/NavigationButton'
import { PageHeading } from './components/layout/PageHeading'
import { PersonalDataLog } from './components/PersonalDataLog'
import { SleepLogger } from './components/SleepLogger'
import { UpdateBanner } from './components/UpdateBanner'
import { db } from './database/db'
import { wasJustDeleted } from './database/deleteAll'
import { createEntries, createEntry } from './database/entries'
import type { CreateEntryInput } from './database/entries'
import {
  createHabit,
  deleteHabit,
  getAllHabits,
  reorderHabits,
  setHabitArchived,
  updateHabit,
} from './database/habits'
import type { CreateHabitInput } from './database/habits'
import { createManualSleepSession } from './database/sleepSessions'
import {
  cancelStopwatch,
  getActiveStopwatches,
  startStopwatch,
  stopStopwatch,
} from './database/stopwatches'
import type { ActiveTimer, Habit } from './database/types'
import { parseNumberInput } from './logging/buildEntryInput'
import { SettingsDataPage } from './pages/SettingsDataPage'
import { describeImportedDays } from './screenTime/autoImport'
import { useAutoImport, useScreenTimeAutoImport } from './screenTime/useScreenTimeAutoImport'
import { applyHealthImport, healthImporter, previewHealthImport } from './healthData/healthImport'
import { applyYnabImport, previewYnabImport, ynabImporter } from './ynab/ynabImport'
import { getYnabConnection } from './ynab/ynabConnection'
import { DEFAULT_DISPLAY_TIMEZONE, loadDisplayTimezone } from './settings/displayTimezone'
import type { DisplayTimezone } from './settings/displayTimezone'
import { isDeviceImportOn } from './settings/deviceImports'
import { getFeatures, isFeatureOn, subscribeFeatures } from './settings/features'
import { isWelcomeDone, needsWelcome } from './settings/welcome'
import { WelcomeScreen } from './components/WelcomeScreen'
import { messages } from './i18n'
import { isSyncConfigured, type SyncBackend } from './sync/backendTypes'
import type { SyncController } from './sync/syncController'

// Loaded on demand: the chart library is only downloaded with the dashboard.
const Dashboard = lazy(() => import('./components/dashboard/Dashboard'))
const AnalysisPage = lazy(() => import('./components/analysis/AnalysisPage'))
const CrmPage = lazy(() => import('./pages/CrmPage'))
const GoalsPage = lazy(() => import('./pages/GoalsPage'))

type Page = 'log' | 'crm' | 'dashboard' | 'analysis' | 'goals' | 'logging' | 'data'


function App() {
  const t = messages()
  // After "Delete all data on this device" the app restarts on Settings & Data.
  const [page, setPage] = useState<Page>(() => (wasJustDeleted() ? 'data' : 'logging'))
  // Optional features on this device (sharing plan S4); unset = all on.
  const features = useSyncExternalStore(subscribeFeatures, getFeatures)
  // First launch on an empty device: the welcome screen (S4).
  // Already set up (the usual case): show the app at once, no check.
  const [welcome, setWelcome] = useState<'checking' | 'show' | 'no'>(() => (isWelcomeDone() ? 'no' : 'checking'))
  const [habits, setHabits] = useState<Habit[]>([])
  const [activeTimers, setActiveTimers] = useState<ActiveTimer[]>([])
  const [displayTimezone, setDisplayTimezone] =
    useState<DisplayTimezone>(DEFAULT_DISPLAY_TIMEZONE)
  // Increased after a restore so data panels reload.
  const [restoreCount, setRestoreCount] = useState(0)
  const [now, setNow] = useState(0)
  const [draggedHabitId, setDraggedHabitId] = useState<string | null>(null)

  const [showArchived, setShowArchived] = useState(false)
  const [editingHabit, setEditingHabit] = useState<Habit | null>(null)
  const [form, setForm] = useState(INITIAL_FORM)

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [actionHabitId, setActionHabitId] = useState<string | null>(null)

  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [autoImportMessage, setAutoImportMessage] = useState('')

  // Sync between devices (Phase 3). Switched off when the sync server is
  // not configured for this build; the Supabase library loads on demand.
  const [syncBackend, setSyncBackend] = useState<SyncBackend | null>(null)
  const [syncController, setSyncController] = useState<SyncController | null>(null)

  async function loadHabits() {
    try {
      const storedHabits = await getAllHabits()
      setHabits(storedHabits)
    } catch (caughtError) {
      console.error('Failed to load habits:', caughtError)
      setError(t.app.errors.loadHabits)
    } finally {
      setLoading(false)
    }
  }

  async function loadActiveTimers() {
    try {
      const timers = await getActiveStopwatches()
      setActiveTimers(timers)
    } catch (caughtError) {
      console.error('Failed to load active stopwatches:', caughtError)
      setError(t.app.errors.loadStopwatches)
    }
  }

  /** Reloads everything after data changed outside this view (sync). */
  function reloadAfterExternalChange() {
    setRestoreCount((count) => count + 1)
    void loadHabits()
    void loadActiveTimers()
    void loadDisplayTimezone().then(setDisplayTimezone)
  }

  useEffect(() => {
    if (isWelcomeDone()) return
    let cancelled = false
    needsWelcome(db)
      .then((show) => {
        if (!cancelled) setWelcome(show ? 'show' : 'no')
      })
      .catch((caught: unknown) => {
        // Never keep the app behind the welcome screen because of an error.
        console.error('Could not check for a first launch:', caught)
        if (!cancelled) setWelcome('no')
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Phone app: import finished screen-time days automatically
  // (src/screenTime/autoImport.ts).
  useScreenTimeAutoImport({
    controller: syncController,
    syncConfigured: isSyncConfigured(),
    onImported: (outcome) => {
      showAutoImportMessage(t.app.autoImport.screenTime(describeImportedDays(outcome.dates)))
      setRestoreCount((count) => count + 1)
    },
  })

  // Phone app: Health Connect activity and heart data, same rules
  // (src/healthData/healthImport.ts, docs/HEALTH_DATA_PLAN.md).
  useAutoImport({
    importer: healthImporter,
    controller: syncController,
    syncConfigured: isSyncConfigured(),
    async hasAccess() {
      // Turned off on this device ("What this device imports").
      if (!isDeviceImportOn('healthConnect')) return false
      const { grantedHealthPermissions } = await import('./healthData/healthDataPlugin')
      const { grantedKinds } = await import('./healthData/healthImport')
      return grantedKinds(await grantedHealthPermissions()).length > 0
    },
    preview: () => previewHealthImport(),
    apply: applyHealthImport,
    onImported: (outcome) => {
      showAutoImportMessage(t.app.autoImport.health(describeImportedDays(outcome.dates)))
      setRestoreCount((count) => count + 1)
    },
  })

  // YNAB, on the device that holds the token (docs/YNAB_PLAN.md).
  useAutoImport({
    importer: ynabImporter,
    controller: syncController,
    syncConfigured: isSyncConfigured(),
    allPlatforms: true,
    hasAccess: async () => isFeatureOn('ynab') && getYnabConnection() !== null,
    preview: () => previewYnabImport(),
    apply: applyYnabImport,
    onImported: (outcome) => {
      showAutoImportMessage(t.app.autoImport.ynab(describeImportedDays(outcome.dates)))
      setRestoreCount((count) => count + 1)
    },
  })

  function showAutoImportMessage(text: string) {
    setAutoImportMessage((current) => (current ? `${current} ${text}` : text))
  }

  useEffect(() => {
    if (!isSyncConfigured()) return
    let cancelled = false
    let stop = () => {}

    void Promise.all([import('./sync/backend'), import('./sync/syncController')]).then(
      ([{ createConfiguredBackend }, { createSyncController }]) => {
        const backend = createConfiguredBackend()
        if (cancelled || !backend) return
        const controller = createSyncController({ db, backend })
        // The reload only uses state setters, so this first-render copy is safe.
        const stopListening = controller.onDataChanged(reloadAfterExternalChange)
        const stopSyncing = controller.start()
        stop = () => {
          stopListening()
          stopSyncing()
        }
        setSyncBackend(backend)
        setSyncController(controller)
      },
    )

    return () => {
      cancelled = true
      stop()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  
    async function saveHabitOrder(orderedIds: string[]) {
    setError('')
    setSuccess('')

    try {
      await reorderHabits(orderedIds)
      await loadHabits()
      setSuccess(t.habitList.orderSaved)
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : t.habitList.orderFailed,
      )
    } finally {
      setDraggedHabitId(null)
    }
  }

  async function handleMoveHabit(
    habitId: string,
    direction: -1 | 1,
  ) {
    const activeHabits = habits.filter((habit) => !habit.archived)
    const currentIndex = activeHabits.findIndex(
      (habit) => habit.id === habitId,
    )

    const targetIndex = currentIndex + direction

    if (
      currentIndex === -1 ||
      targetIndex < 0 ||
      targetIndex >= activeHabits.length
    ) {
      return
    }

    const orderedIds = activeHabits.map((habit) => habit.id)

    ;[orderedIds[currentIndex], orderedIds[targetIndex]] = [
      orderedIds[targetIndex],
      orderedIds[currentIndex],
    ]

    await saveHabitOrder(orderedIds)
  }

  function handleHabitDragStart(
    habitId: string,
    event: DragEvent<HTMLButtonElement>,
  ) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', habitId)
    setDraggedHabitId(habitId)
  }

  async function handleHabitDrop(
    targetHabitId: string,
    event: DragEvent<HTMLElement>,
  ) {
    event.preventDefault()

    const draggedId =
      event.dataTransfer.getData('text/plain') || draggedHabitId

    if (!draggedId || draggedId === targetHabitId) {
      setDraggedHabitId(null)
      return
    }

    const orderedIds = habits
      .filter((habit) => !habit.archived)
      .map((habit) => habit.id)

    const sourceIndex = orderedIds.indexOf(draggedId)
    const targetIndex = orderedIds.indexOf(targetHabitId)

    if (sourceIndex === -1 || targetIndex === -1) {
      setDraggedHabitId(null)
      return
    }

    orderedIds.splice(sourceIndex, 1)
    orderedIds.splice(targetIndex, 0, draggedId)

    await saveHabitOrder(orderedIds)
  }

  // Phone app: keep the hourly screen-time capture scheduled (Usage access
  // on and not turned off by the user). Loaded on demand; never blocks.
  useEffect(() => {
    if (Capacitor.getPlatform() !== 'android') return
    // Screen time off on this device (switch or feature): never start it.
    if (!isDeviceImportOn('screenTime')) return
    import('./screenTime/usageStatsPlugin')
      .then((plugin) => plugin.ensureUsageCapture())
      .catch((caughtError: unknown) => console.error('Could not start screen-time saving:', caughtError))
  }, [])

  useEffect(() => {
    let cancelled = false

    Promise.all([
      getAllHabits(),
      getActiveStopwatches(),
      loadDisplayTimezone(),
    ])
      .then(([storedHabits, timers, storedDisplayTimezone]) => {
        if (!cancelled) {
          setHabits(storedHabits)
          setActiveTimers(timers)
          setDisplayTimezone(storedDisplayTimezone)
        }
      })
      .catch((caughtError: unknown) => {
        console.error('Failed to load application data:', caughtError)

        if (!cancelled) {
          setError(messages().app.errors.loadAppData)
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

useEffect(() => {
  const intervalId = window.setInterval(() => {
    setNow(Date.now())
  }, 1000)

  return () => {
    window.clearInterval(intervalId)
  }
}, [])

  function resetForm() {
    setForm(INITIAL_FORM)
    setEditingHabit(null)
    setError('')
  }

  function startEditing(habit: Habit) {
    setEditingHabit(habit)

    setForm({
      name: habit.name,
      type: habit.type,
      unit: habit.unit ?? '',
      labelOptions: habit.labelOptions?.join(', ') ?? '',
      color: habit.color,
      dailyAggregation: habit.type === 'number' ? habit.dailyAggregation : 'sum',
      target:
        habit.type === 'number' && habit.target !== null ? String(habit.target) : '',
    })

    setError('')
    setSuccess('')
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    setError('')
    setSuccess('')
    setSaving(true)

    let target: number | null = null

    if (form.type === 'number' && form.target.trim() !== '') {
      try {
        target = parseNumberInput(form.target)
      } catch {
        setError(t.habitList.targetNotNumber)
        setSaving(false)
        return
      }
    }

    const input: CreateHabitInput = {
      name: form.name,
      type: form.type,
      unit: form.unit || null,
      labelOptions:
        form.type === 'label'
          ? form.labelOptions.split(',').map((option) => option.trim())
          : null,
      color: form.color,
      dailyAggregation: form.dailyAggregation,
      target,
    }

    try {
      if (editingHabit) {
        await updateHabit(editingHabit.id, input)
        setSuccess(t.habitList.updated)
      } else {
        await createHabit(input)
        setSuccess(t.habitList.created)
      }

      resetForm()
      await loadHabits()
    } catch (caughtError) {
      const message =
        caughtError instanceof Error
          ? caughtError.message
          : t.app.errors.unexpected

      setError(message)
    } finally {
      setSaving(false)
    }
  }

  async function handleArchive(habit: Habit) {
    setError('')
    setSuccess('')

    if (!habit.archived && activeTimers.some(
      (timer) => timer.habitId === habit.id,
    )) {
      setError(
        t.habitList.stopBeforeArchiving,
      )
      return
    }

    try {
      await setHabitArchived(habit.id, !habit.archived)
      await loadHabits()

      setSuccess(
        habit.archived
          ? t.habitList.restored
          : t.habitList.archived,
      )
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : t.habitList.updateFailed,
      )
    }
  }

  async function handleDelete(habit: Habit) {
    if (activeTimers.some(
      (timer) => timer.habitId === habit.id,
    )) {
      setError(
        t.habitList.stopBeforeDeleting,
      )
      return
    }

    const confirmed = window.confirm(
      t.habitList.confirmDelete(habit.name),
    )

    if (!confirmed) {
      return
    }

    setError('')
    setSuccess('')

    try {
      await deleteHabit(habit.id)

      if (editingHabit?.id === habit.id) {
        resetForm()
      }

      await loadHabits()
      setSuccess(t.habitList.deleted)
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : t.habitList.deleteFailed,
      )
    }
  }

  async function handleStartStopwatch(habit: Habit) {
    setError('')
    setSuccess('')
    setActionHabitId(habit.id)

    try {
      await startStopwatch(habit.id)
      await loadActiveTimers()

      setSuccess(t.stopwatch.started(habit.name))
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : t.stopwatch.startFailed,
      )
    } finally {
      setActionHabitId(null)
    }
  }

  async function handleStopStopwatch(habit: Habit) {
    setError('')
    setSuccess('')
    setActionHabitId(habit.id)

    try {
      await stopStopwatch(habit.id)
      await loadActiveTimers()

      setSuccess(t.stopwatch.stopped(habit.name))
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : t.stopwatch.stopFailed,
      )
    } finally {
      setActionHabitId(null)
    }
  }

  async function handleCancelStopwatch(habit: Habit) {
    const confirmed = window.confirm(
      t.stopwatch.confirmCancel(habit.name),
    )

    if (!confirmed) {
      return
    }

    setError('')
    setSuccess('')
    setActionHabitId(habit.id)

    try {
      await cancelStopwatch(habit.id)
      await loadActiveTimers()

      setSuccess(t.stopwatch.cancelled(habit.name))
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : t.stopwatch.cancelFailed,
      )
    } finally {
      setActionHabitId(null)
    }
  }
  
  // Errors are shown next to the entry form inside the habit card.
  async function handleCreateEntry(
    input: CreateEntryInput,
  ): Promise<void> {
    setError('')
    setSuccess('')
    await createEntry(input)
  }

  // Several categories logged at once: one entry each, all or none.
  async function handleCreateEntries(
    inputs: CreateEntryInput[],
  ): Promise<void> {
    setError('')
    setSuccess('')
    await createEntries(inputs)
  }

  // Labels added or removed from a category habit's logging panel. Errors
  // (e.g. a label used by entries) are shown inside the habit card.
  async function handleUpdateLabelOptions(
    habit: Habit,
    labelOptions: string[],
  ): Promise<void> {
    setError('')
    setSuccess('')
    const updated = await updateHabit(habit.id, { labelOptions })

    // Keep an open Edit form for this habit in step, so saving the form
    // later does not undo the change.
    if (editingHabit?.id === habit.id) {
      setEditingHabit(updated)
      setForm((current) => ({
        ...current,
        labelOptions: updated.labelOptions?.join(', ') ?? '',
      }))
    }

    await loadHabits()
  }

  const activeHabits = habits.filter((habit) => !habit.archived)

  const visibleHabits = showArchived
    ? habits.filter((habit) => habit.archived)
    : activeHabits

  // A page whose feature is turned off shows Data Logging instead.
  const shownPage: Page = (page === 'goals' && !features.goals) || (page === 'crm' && !features.crm) ? 'logging' : page

  if (welcome === 'checking') return null
  if (welcome === 'show') return <WelcomeScreen database={db} onDone={() => setWelcome('no')} />

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* The offline service worker is only for the web version: inside
          the Android app the files are already on the phone. */}
      {!Capacitor.isNativePlatform() && <UpdateBanner />}

      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              {t.app.name}
            </h1>

            <p className="mt-1 text-sm text-slate-500">
              {t.app.tagline}
            </p>
          </div>

          <nav
            aria-label={t.app.mainNavigation}
            className="flex flex-wrap gap-2"
          >
            <NavigationButton
              active={shownPage === 'log'}
              onClick={() => setPage('log')}
            >
              {t.app.nav.log}
            </NavigationButton>

            {features.crm && (
              <NavigationButton
                active={shownPage === 'crm'}
                onClick={() => setPage('crm')}
              >
                {t.app.nav.crm}
              </NavigationButton>
            )}

            <NavigationButton
              active={shownPage === 'dashboard'}
              onClick={() => setPage('dashboard')}
            >
              {t.app.nav.dashboard}
            </NavigationButton>

            <NavigationButton
              active={shownPage === 'analysis'}
              onClick={() => setPage('analysis')}
            >
              {t.app.nav.analysis}
            </NavigationButton>

            {features.goals && (
              <NavigationButton
                active={shownPage === 'goals'}
                onClick={() => setPage('goals')}
              >
                {t.app.nav.goals}
              </NavigationButton>
            )}

            <NavigationButton
              active={shownPage === 'logging'}
              onClick={() => setPage('logging')}
            >
              {t.app.nav.logging}
            </NavigationButton>

            <NavigationButton
              active={shownPage === 'data'}
              onClick={() => setPage('data')}
            >
              {t.app.nav.data}
            </NavigationButton>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {autoImportMessage && (
          <div role="status" className="mb-6 flex items-start justify-between gap-3 rounded-lg bg-green-50 p-3 text-sm text-green-700">
            <span>{autoImportMessage}</span>
            <button
              type="button"
              onClick={() => setAutoImportMessage('')}
              className="rounded px-2 font-medium hover:underline"
              aria-label={t.app.closeMessage}
            >
              ×
            </button>
          </div>
        )}

        {(error || success) && (
          <div className="mb-6 space-y-2">
            {error && (
              <p
                role="alert"
                className="rounded-lg bg-red-50 p-3 text-sm text-red-700"
              >
                {error}
              </p>
            )}

            {success && (
              <p
                role="status"
                className="rounded-lg bg-green-50 p-3 text-sm text-green-700"
              >
                {success}
              </p>
            )}
          </div>
        )}

        {shownPage === 'logging' && (
          <section>
            <PageHeading
              title={t.app.pages.logging.title}
              description={t.app.pages.logging.description}
            />

            <SleepLogger
              onCreateSleep={async (input) => {
                setError('')
                setSuccess('')
                await createManualSleepSession(input)
              }}
            />

            <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
              <HabitForm
                form={form}
                setForm={setForm}
                editingHabit={editingHabit}
                saving={saving}
                onSubmit={handleSubmit}
                onCancel={resetForm}
              />

              <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold">
                      {t.habitList.title}
                    </h2>

                    <p className="mt-1 text-sm text-slate-500">
                      {t.habitList.total(habits.length)}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => setShowArchived(!showArchived)}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-50"
                  >
                    {showArchived ? t.habitList.showActive : t.habitList.showArchived}
                  </button>
                </div>

                <div className="mt-5 space-y-3">
                  {loading ? (
                    <p className="py-8 text-center text-sm text-slate-500">
                      {t.app.loading.habits}
                    </p>
                  ) : visibleHabits.length === 0 ? (
                    <p className="rounded-lg bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                      {showArchived
                        ? t.habitList.noArchived
                        : t.habitList.noHabits}
                    </p>
                  ) : (
                    visibleHabits.map((habit) => (
                      <HabitCard
                        key={habit.id}
                        habit={habit}
                        activeTimer={activeTimers.find(
                          (timer) => timer.habitId === habit.id,
                        )}
                        now={now}
                        displayTimezone={displayTimezone}
                        busy={actionHabitId === habit.id}
                        position={activeHabits.findIndex(
                          (item) => item.id === habit.id,
                        )}
                        totalActiveHabits={activeHabits.length}
                        dragged={draggedHabitId === habit.id}
                        onEdit={startEditing}
                        onArchive={handleArchive}
                        onDelete={handleDelete}
                        onStart={handleStartStopwatch}
                        onStop={handleStopStopwatch}
                        onCancel={handleCancelStopwatch}
                        onCreateEntry={handleCreateEntry}
                        onCreateEntries={handleCreateEntries}
                        onUpdateLabelOptions={handleUpdateLabelOptions}
                        onMoveUp={() =>
                          void handleMoveHabit(habit.id, -1)
                        }
                        onMoveDown={() =>
                          void handleMoveHabit(habit.id, 1)
                        }
                        onDragStart={(event) =>
                          handleHabitDragStart(habit.id, event)
                        }
                        onDrop={(event) =>
                          void handleHabitDrop(habit.id, event)
                        }
                        onDragEnd={() => setDraggedHabitId(null)}
                      />
                    ))
                  )}
                </div>
              </section>
            </div>
          </section>
        )}

        {shownPage === 'dashboard' && (
          <section>
            <PageHeading
              title={t.app.pages.dashboard.title}
              description={t.app.pages.dashboard.description}
            />

            <Suspense
              fallback={
                <p className="py-8 text-center text-sm text-slate-500">
                  {t.app.loading.dashboard}
                </p>
              }
            >
              <Dashboard key={restoreCount} onHabitsReordered={() => void loadHabits()} />
            </Suspense>
          </section>
        )}

        {shownPage === 'analysis' && (
          <section>
            <PageHeading
              title={t.app.pages.analysis.title}
              description={t.app.pages.analysis.description}
            />

            <Suspense
              fallback={
                <p className="py-8 text-center text-sm text-slate-500">
                  {t.app.loading.analysis}
                </p>
              }
            >
              <AnalysisPage key={restoreCount} />
            </Suspense>
          </section>
        )}

        {shownPage === 'log' && (
          <section>
            <PageHeading
              title={t.app.pages.log.title}
              description={t.app.pages.log.description}
            />

            <PersonalDataLog displayTimezone={displayTimezone} />
          </section>
        )}

        {shownPage === 'goals' && (
          <Suspense
            fallback={
              <p className="py-8 text-center text-sm text-slate-500">
                {t.app.loading.goals}
              </p>
            }
          >
            <GoalsPage dataVersion={restoreCount} />
          </Suspense>
        )}

        {shownPage === 'crm' && (
          <Suspense
            fallback={
              <p className="py-8 text-center text-sm text-slate-500">
                {t.app.loading.contacts}
              </p>
            }
          >
            {/* No reload key (it would reset unsaved edits): the page reloads
                its data in place when dataVersion changes (sync, restore). */}
            <CrmPage displayTimezone={displayTimezone} dataVersion={restoreCount} />
          </Suspense>
        )}

        {shownPage === 'data' && (
          <SettingsDataPage
            syncBackend={syncBackend}
            syncController={syncController}
            displayTimezone={displayTimezone}
            setDisplayTimezone={setDisplayTimezone}
            restoreCount={restoreCount}
            setRestoreCount={setRestoreCount}
            reloadAfterExternalChange={reloadAfterExternalChange}
            loadHabits={loadHabits}
            loadActiveTimers={loadActiveTimers}
          />
        )}
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-4 text-xs text-slate-500 sm:px-6 lg:px-8">
          {t.app.footer}
        </div>
      </footer>
    </div>
  )
}

export default App

