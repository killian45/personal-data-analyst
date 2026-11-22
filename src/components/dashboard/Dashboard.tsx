import { useEffect, useId, useState, type ReactNode } from 'react'

import { reorderHabits } from '../../database/habits'
import { loadDashboardData } from '../../dashboard/loadDashboardData'
import type { DashboardData } from '../../dashboard/loadDashboardData'
import { entryDate, habitDailyObservations, habitTextValues, sleepObservations } from '../../dashboard/observations'
import { inRange, presetRange } from '../../dashboard/periods'
import { arrangeSections, LOCATION_SECTION_ID, moveVisibleSection, SCREEN_TIME_SECTION_ID } from '../../dashboard/sectionOrder'
import { awayFromSeries, listPlaces, LOCATION_MEASURES, locationSeries, MODE_GROUP_LABELS, MODE_GROUPS, timeInSeries } from '../../location/dailyLocation'
import type { LocationMeasure } from '../../location/dailyLocation'
import { saveAwayPlace, saveLocationMeasure, savePlaceName } from '../../settings/dashboardLocation'
import { placeLabel } from '../../location/places'
import { buildMeasures } from '../../analysis/measures'
import { Capacitor } from '@capacitor/core'
import { AiSummaryPanel } from './AiSummaryPanel'
import { formulaDaily } from '../../formulas/display'
import { AwayPlaceControls } from './AwayPlaceControls'
import { appUsageTotals, screenTimeObservations } from '../../screenTime/dailyScreenTime'
import type { Aggregation, RangePreset } from '../../dashboard/periods'
import { formatValue } from '../../dashboard/format'
import { parseDateDMY, formatDateDMY } from '../../logging/dateTimeInput'
import { metricsForSection, saveSectionMetrics } from '../../settings/dashboardMetrics'
import { saveSectionOrder } from '../../settings/dashboardOrder'
import { AI_SUMMARY_SECTION_ID, saveHiddenSections } from '../../settings/dashboardHidden'
import { chosenNames, MAX_CHOSEN_APPS, saveChosenApps, toggleChosenApp } from '../../settings/dashboardScreenTimeApps'
import type { ChosenAppSlots } from '../../settings/dashboardScreenTimeApps'
import { ScreenTimeAppsSection } from './ScreenTimeAppsSection'
import { MultiSeriesChart, MultiSeriesTable } from './MultiSeriesChart'
import type { ChartSeries } from './MultiSeriesChart'
import { aggregateMany } from '../../dashboard/periods'
import { OTHER_CATEGORY, spendingByCategory, spendingForCategories, sumSeries } from '../../ynab/ynabDaily'
import { MAX_CHOSEN_CATEGORIES, saveChosenCategories } from '../../settings/dashboardYnabCategories'
import { toggleSlot } from '../../settings/chosenSlots'
import { ItemChooser } from './ItemChooser'
import { HEALTH_DAILY_KINDS, HEALTH_LABELS } from '../../healthData/healthData'
import type { HealthKind } from '../../healthData/healthData'
import { exerciseSummary, healthSeries } from '../../healthData/healthDaily'
import { spendingSummary } from '../../ynab/ynabDaily'
import { describeDisplayTimezone, resolveDisplayZone } from '../../settings/displayTimezone'
import { clockTargetToAxisHours } from '../../settings/sleepTargets'
import { formatDuration } from '../../stopwatch/duration'
import { describe } from '../../stats/descriptive'
import { stopwatchSummary } from '../../stats/habitSummaries'
import type { DateRange } from '../../stats/delta'
import { getDeviceTimezone, utcToLocalDateTime } from '../../time/time'
import { formatNumber, messages } from '../../i18n'
import { isFeatureOn } from '../../settings/features'

import { DateDMYField } from '../DateDMYField'

import { CheckboxSection, CountsSection } from './HabitSections'
import { NumericSection } from './NumericSection'
import { rangeLabel } from './periodLabels'
import type { SectionOrder } from './SectionOrderControls'
import { PanelVisibilityControls } from './PanelVisibilityControls'
import { PeriodNavigator } from './PeriodNavigator'
import { shiftRange, smallStep, rangeLength, swipeMove } from '../../dashboard/periods'
import type { PanelChoice } from './PanelVisibilityControls'

const PRESETS: readonly RangePreset[] = ['7d', '30d', '90d', 'custom']

const AGGREGATIONS: readonly Aggregation[] = ['day', 'week', 'month']

/** Today's date in the display timezone (device timezone when showing event timezones). */
function today(data: DashboardData): string {
  const device = getDeviceTimezone()
  return utcToLocalDateTime(new Date().toISOString(), resolveDisplayZone(data.displayTimezone, device, device)).slice(0, 10)
}

/**
 * Dashboard (PROJECT_SPEC.md §6.2): sleep duration, bedtime, wake time,
 * then habits, for 7/30/90 days or a custom range, grouped by day, week
 * or month. Statistics always use one value per night/day; every number
 * can be traced to the data table and the records behind it.
 */
interface DashboardProps {
  /** Called after habits were re-arranged here (other pages reload them). */
  onHabitsReordered?: () => void
}

export default function Dashboard({ onHabitsReordered }: DashboardProps = {}) {
  const t = messages().dashboard
  const id = useId()
  const [data, setData] = useState<DashboardData | null>(null)
  const [loadError, setLoadError] = useState('')
  const [preset, setPreset] = useState<RangePreset>('30d')
  const [aggregation, setAggregation] = useState<Aggregation>('day')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  /** Days the 7/30/90-day view is moved back from today (0 or negative). */
  const [shift, setShift] = useState(0)
  const [touchStart, setTouchStart] = useState<{ x: number; y: number } | null>(null)
  const [saveError, setSaveError] = useState('')

  useEffect(() => {
    let cancelled = false

    loadDashboardData()
      .then((loaded) => {
        if (!cancelled) {
          setData(loaded)
        }
      })
      .catch((error: unknown) => {
        console.error('Failed to load the dashboard:', error)
        if (!cancelled) {
          setLoadError(messages().dashboard.loadFailed)
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  if (loadError) {
    return <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{loadError}</p>
  }

  if (!data) {
    return <p className="py-8 text-center text-sm text-slate-500">{messages().app.loading.dashboard}</p>
  }

  const todayDate = today(data)
  let range: DateRange | null = null
  let rangeError = ''

  if (preset === 'custom') {
    const from = parseDateDMY(customFrom)
    const to = parseDateDMY(customTo)

    if (from === null || to === null) {
      rangeError = t.customRangeMissing
    } else if (to < from) {
      rangeError = t.customRangeOrder
    } else {
      range = { start: from, end: to }
    }
  } else {
    range = shiftRange(presetRange(preset, todayDate), shift, todayDate)
  }

  /** Moves the shown dates by `days` (negative = earlier), never past today. */
  function moveRange(days: number) {
    if (!range) return
    if (preset === 'custom') {
      const moved = shiftRange(range, days, todayDate)
      setCustomFrom(formatDateDMY(moved.start))
      setCustomTo(formatDateDMY(moved.end))
    } else {
      setShift((current) => Math.min(0, current + days))
    }
  }

  function backToToday() {
    if (!range) return
    if (preset === 'custom') moveRange(rangeLength({ start: range.end, end: todayDate }) - 1)
    else setShift(0)
  }

  // Swipes (phone): finger right = earlier; short = small step, long = whole period.
  function onTouchStart(event: React.TouchEvent) {
    const target = event.target as HTMLElement
    const ignored = target.closest('input, textarea, select, [data-no-swipe], .overflow-auto, .overflow-x-auto')
    setTouchStart(ignored || event.touches.length !== 1 ? null : { x: event.touches[0].clientX, y: event.touches[0].clientY })
  }

  function onTouchEnd(event: React.TouchEvent) {
    if (!touchStart || !range) return
    const touch = event.changedTouches[0]
    const move = swipeMove(touch.clientX - touchStart.x, touch.clientY - touchStart.y, window.innerWidth)
    setTouchStart(null)
    if (move) moveRange(move.direction * (move.size === 'full' ? rangeLength(range) : smallStep(range)))
  }

  async function updateMetrics(sectionId: string, metricIds: string[]) {
    setSaveError('')
    try {
      const metricSelection = await saveSectionMetrics(sectionId, metricIds)
      setData((current) => (current ? { ...current, metricSelection } : current))
    } catch {
      setSaveError(t.saveFailed.metrics)
    }
  }

  /**
   * Moves a section one place up (-1) or down (+1). Two habits swapped →
   * shared habit order (also Data Logging); otherwise → dashboard layout.
   */
  async function moveSectionAt(arranged: readonly string[], hidden: ReadonlySet<string>, visibleIndex: number, direction: -1 | 1) {
    const move = moveVisibleSection(arranged, hidden, visibleIndex, direction)
    if (move.kind === 'none') return

    setSaveError('')
    try {
      if (move.kind === 'habit-order') {
        await reorderHabits(move.habitIds)
        setData((current) => {
          if (!current) return current
          const byId = new Map(current.habits.map((habit) => [habit.id, habit]))
          return { ...current, habits: move.habitIds.flatMap((id) => byId.get(id) ?? []) }
        })
        onHabitsReordered?.()
      } else {
        await saveSectionOrder(move.order)
        setData((current) => (current ? { ...current, sectionOrder: move.order } : current))
      }
    } catch {
      setSaveError(t.saveFailed.order)
    }
  }

  const sleep = sleepObservations(data.sleep.nights)
  const nothingAtAll =
    data.sleep.nights.length === 0 && data.habits.length === 0 && data.screenTime.length === 0 && data.location.length === 0 &&
    data.formulas.length === 0 && data.health.length === 0 && data.ynab.length === 0

  async function changeScreenTimeApps(names: ChosenAppSlots) {
    setSaveError('')
    try {
      const screenTimeApps = await saveChosenApps(names)
      setData((current) => (current ? { ...current, screenTimeApps } : current))
    } catch {
      setSaveError(t.saveFailed.apps)
    }
  }

  async function changeYnabCategories(slots: ChosenAppSlots) {
    setSaveError('')
    try {
      const ynabCategories = await saveChosenCategories(slots)
      setData((current) => (current ? { ...current, ynabCategories } : current))
    } catch {
      setSaveError(t.saveFailed.categories)
    }
  }

  async function changeHidden(next: readonly string[]) {
    setSaveError('')
    try {
      const hiddenSections = await saveHiddenSections(next)
      setData((current) => (current ? { ...current, hiddenSections } : current))
    } catch {
      setSaveError(t.saveFailed.hidden)
    }
  }

  async function changeAwayPlace(placeKey: string) {
    setSaveError('')
    try {
      const saved = await saveAwayPlace(placeKey)
      setData((current) => (current ? { ...current, awayPlace: saved } : current))
    } catch {
      setSaveError(t.saveFailed.place)
    }
  }

  async function renamePlace(placeKey: string, name: string) {
    const placeNames = await savePlaceName(placeKey, name)
    setData((current) => (current ? { ...current, placeNames } : current))
  }

  async function changeLocationMeasure(measure: LocationMeasure) {
    setSaveError('')
    try {
      const saved = await saveLocationMeasure(measure)
      setData((current) => (current ? { ...current, locationMeasure: saved } : current))
    } catch {
      setSaveError(t.saveFailed.locationView)
    }
  }

  return (
    <div className="space-y-6" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <div className="flex flex-wrap items-end gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <fieldset>
          <legend className="mb-1 text-xs font-medium text-slate-600">{t.range}</legend>
          <div className="flex flex-wrap gap-1">
            {PRESETS.map((item) => (
              <button
                key={item}
                type="button"
                aria-pressed={preset === item}
                onClick={() => {
                  setPreset(item)
                  setShift(0)
                }}
                className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                  preset === item ? 'bg-blue-600 text-white' : 'border border-slate-300 hover:bg-slate-100'
                }`}
              >
                {t.presets[item]}
              </button>
            ))}
          </div>
        </fieldset>

        {preset === 'custom' && (
          <div className="flex flex-wrap gap-2">
            <DateDMYField id={`${id}-from`} label={t.from} showLabel value={customFrom} onChange={setCustomFrom} className="w-36" />
            <DateDMYField id={`${id}-to`} label={t.to} showLabel value={customTo} onChange={setCustomTo} className="w-36" />
          </div>
        )}

        <div>
          <label htmlFor={`${id}-group`} className="mb-1 block text-xs font-medium text-slate-600">{t.groupBy}</label>
          <select
            id={`${id}-group`}
            value={aggregation}
            onChange={(event) => setAggregation(event.target.value as Aggregation)}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm"
          >
            {AGGREGATIONS.map((item) => (
              <option key={item} value={item}>{t.aggregations[item]}</option>
            ))}
          </select>
        </div>
      </div>

      {range && (
        <PeriodNavigator
          range={range}
          today={todayDate}
          label={rangeLabel(range.start, range.end)}
          onMove={moveRange}
          onToday={backToToday}
        />
      )}

      {range && (
        <p className="text-sm text-slate-600">
          {t.rangeSummary(rangeLabel(range.start, range.end), describeDisplayTimezone(data.displayTimezone))}
        </p>
      )}

      {rangeError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{rangeError}</p>}
      {saveError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{saveError}</p>}

      {nothingAtAll && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center text-sm text-slate-500">
          {t.nothingYet}
        </div>
      )}

      {range && !nothingAtAll && Capacitor.getPlatform() === 'web' && !data.hiddenSections.includes(AI_SUMMARY_SECTION_ID) && (
        <AiSummaryPanel measures={buildMeasures(data)} range={range} />
      )}

      {range && !nothingAtAll && (
        <DashboardSections
          data={data}
          range={range}
          aggregation={aggregation}
          sleep={sleep}
          onMetricsChange={updateMetrics}
          onMove={(arranged, hidden, index, direction) => void moveSectionAt(arranged, hidden, index, direction)}
          onHiddenChange={(next) => void changeHidden(next)}
          onScreenTimeAppsChange={(slots) => void changeScreenTimeApps(slots)}
          onYnabCategoriesChange={(slots) => void changeYnabCategories(slots)}
          showAiSummaryChoice={Capacitor.getPlatform() === 'web'}
          onLocationMeasureChange={(measure) => void changeLocationMeasure(measure)}
          onAwayPlaceChange={(placeKey) => void changeAwayPlace(placeKey)}
          onPlaceRename={renamePlace}
        />
      )}
    </div>
  )
}

interface SectionsProps {
  data: DashboardData
  range: DateRange
  aggregation: Aggregation
  sleep: ReturnType<typeof sleepObservations>
  onMetricsChange: (sectionId: string, metricIds: string[]) => void
  onMove: (arranged: readonly string[], hidden: ReadonlySet<string>, visibleIndex: number, direction: -1 | 1) => void
  onHiddenChange: (hidden: readonly string[]) => void
  onScreenTimeAppsChange: (slots: ChosenAppSlots) => void
  onYnabCategoriesChange: (slots: ChosenAppSlots) => void
  /** The AI summary exists on this device (computer only). */
  showAiSummaryChoice: boolean
  onLocationMeasureChange: (measure: LocationMeasure) => void
  onAwayPlaceChange: (placeKey: string) => void
  onPlaceRename: (placeKey: string, name: string) => Promise<void>
}

/** The four views of the Location section (docs/PHASE5_PLAN.md §7.6). */
/** Texts: messages().dashboard.location.views. */
const LOCATION_VIEWS: Record<LocationMeasure, { subject: 'number' | 'stopwatch'; unit: string | null }> = {
  distance: { subject: 'number', unit: 'km' },
  active: { subject: 'stopwatch', unit: null },
  in: { subject: 'stopwatch', unit: null },
  away: { subject: 'stopwatch', unit: null },
  places: { subject: 'number', unit: null },
}

function DashboardSections({
  data, range, aggregation, sleep, onMetricsChange, onMove, onHiddenChange, onScreenTimeAppsChange, onYnabCategoriesChange, showAiSummaryChoice, onLocationMeasureChange, onAwayPlaceChange, onPlaceRename,
}: SectionsProps) {
  const t = messages().dashboard
  const nights = data.sleep.nights.filter((night) => night.nightDate >= range.start && night.nightDate <= range.end)
  const naps = data.sleep.naps.filter((nap) => nap.nightDate >= range.start && nap.nightDate <= range.end)
  const sessionCount = new Set(nights.flatMap((night) => night.sessionIds)).size
  const methods = nights.flatMap((night) => night.methods)
  const methodText = (['stages', 'reported', 'elapsed'] as const)
    .map((method) => [method, methods.filter((item) => item === method).length] as const)
    .filter(([, count]) => count > 0)
    .map(([method, count]) => t.sleep.method(count, method))
    .join(', ')
  const warnings = [
    ...nights.flatMap((night) => night.warnings.map((warning) => t.sleep.nightWarning(night.nightDate, warning))),
    ...data.sleep.excluded.map((item) => t.sleep.excluded(item.reason)),
  ]
  const sleepTrace = t.sleep.trace(nights.length, sessionCount, methodText)

  const timeInBed = describe(inRange(sleep.timeInBed, range).map((o) => o.value))
  const napTotalMs = naps.reduce((sum, nap) => sum + nap.elapsedMs, 0)

  const metricsOf = (sectionId: string) => metricsForSection(data.metricSelection, sectionId)
  const sleepEmpty = t.sleep.empty

  const screenTime = screenTimeObservations(data.screenTime)
  const location = locationSeries(data.location)
  const arranged = arrangeSections(data.sectionOrder, data.habits.map((habit) => habit.id), {
    // Optional features that are off (sharing plan S4) show no panel; their data is kept.
    screenTime: screenTime.daily.length > 0 && isFeatureOn('screenTime'),
    location: data.location.length > 0 && isFeatureOn('location'),
    formulaIds: data.formulas.map((formula) => formula.id),
    healthIds: [
      ...HEALTH_DAILY_KINDS.filter((kind) => healthSeries(data.health, kind).daily.length > 0).map((kind) => `health:${kind}`),
      ...(exerciseSummary(data.health).sessions > 0 ? ['health:exercise'] : []),
      ...(data.ynab.length > 0 && isFeatureOn('ynab') ? ['ynab:spending'] : []),
    ],
  })
  const baseMeasures = data.formulas.length > 0 ? buildMeasures({ ...data, formulas: [] }) : []
  const habitsById = new Map(data.habits.map((habit) => [habit.id, habit]))
  const [appListOpen, setAppListOpen] = useState(false)
  const [categoryListOpen, setCategoryListOpen] = useState(false)
  const hidden = new Set(data.hiddenSections)
  const visible = arranged.filter((id) => !hidden.has(id))
  const orderFor = (index: number): SectionOrder | undefined =>
    visible.length > 1
      ? {
          onMoveUp: index > 0 ? () => onMove(arranged, hidden, index, -1) : null,
          onMoveDown: index < visible.length - 1 ? () => onMove(arranged, hidden, index, 1) : null,
        }
      : undefined

  const SLEEP_TITLES: Record<string, string> = { sleepDuration: t.sleep.durationTitle, bedtime: t.sleep.bedtimeTitle, wakeTime: t.sleep.wakeTitle }
  const panelTitle = (sectionId: string): string =>
    SLEEP_TITLES[sectionId] ??
    (sectionId === SCREEN_TIME_SECTION_ID ? t.screenTime.title
      : sectionId === LOCATION_SECTION_ID ? t.location.title
        : sectionId === 'ynab:spending' ? t.spending.title
        : sectionId.startsWith('health:') ? HEALTH_LABELS[sectionId.slice('health:'.length) as HealthKind | 'exercise'] ?? sectionId
        : sectionId.startsWith('habit:') ? habitsById.get(sectionId.slice('habit:'.length))?.name ?? t.habitFallback
          : data.formulas.find((formula) => `formula:${formula.id}` === sectionId)?.name ?? sectionId)
  const panels: PanelChoice[] = [
    ...(showAiSummaryChoice ? [{ id: AI_SUMMARY_SECTION_ID, title: t.aiSummary }] : []),
    ...arranged.map((id) => ({ id, title: panelTitle(id) })),
  ]
  const setPanelHidden = (id: string, hide: boolean) =>
    onHiddenChange(hide ? [...data.hiddenSections, id] : data.hiddenSections.filter((item) => item !== id))

  function renderSection(sectionId: string, order: SectionOrder | undefined): ReactNode {
    switch (sectionId) {
      case 'sleepDuration':
        return (
          <NumericSection
            key="sleepDuration"
            order={order}
            title={t.sleep.durationTitle}
            description={t.sleep.durationDescription}
            subject="sleepDuration"
            daily={sleep.sleepDuration}
            range={range}
            aggregation={aggregation}
            target={data.targets.sleepDurationMinutes === null ? null : data.targets.sleepDurationMinutes / 60}
            metricIds={metricsOf('sleepDuration')}
            onMetricsChange={(ids) => onMetricsChange('sleepDuration', ids)}
            chartKind="bar"
            unitOfObservation="night"
            extraTiles={[
              {
                id: 'extra:time-in-bed',
                description: t.sleep.timeInBedDescription,
                label: t.sleep.timeInBedLabel,
                value: timeInBed.insufficient || timeInBed.mean === null ? t.tiles.insufficient : formatValue('timeInBed', timeInBed.mean),
                note: `n = ${timeInBed.n}`,
              },
              {
                id: 'extra:naps',
                description: t.sleep.napsDescription,
                label: t.sleep.napsLabel,
                value: String(naps.length),
                note: naps.length > 0 ? t.sleep.napsTotal(formatDuration(napTotalMs)) : t.sleep.napsRule,
              },
            ]}
            trace={sleepTrace}
            warnings={warnings}
            emptyMessage={sleepEmpty}
          />
        )
      case 'bedtime':
        return (
          <NumericSection
            key="bedtime"
            order={order}
            title={t.sleep.bedtimeTitle}
            description={t.sleep.bedtimeDescription}
            subject="bedtime"
            daily={sleep.bedtime}
            range={range}
            aggregation={aggregation}
            target={data.targets.bedtime === null ? null : clockTargetToAxisHours(data.targets.bedtime, 'bedtime')}
            metricIds={metricsOf('bedtime')}
            onMetricsChange={(ids) => onMetricsChange('bedtime', ids)}
            chartKind="line"
            unitOfObservation="night"
            trace={sleepTrace}
            emptyMessage={sleepEmpty}
          />
        )
      case 'wakeTime':
        return (
          <NumericSection
            key="wakeTime"
            order={order}
            title={t.sleep.wakeTitle}
            description={t.sleep.wakeDescription}
            subject="wakeTime"
            daily={sleep.wakeTime}
            range={range}
            aggregation={aggregation}
            target={data.targets.wakeTime === null ? null : clockTargetToAxisHours(data.targets.wakeTime, 'wakeTime')}
            metricIds={metricsOf('wakeTime')}
            onMetricsChange={(ids) => onMetricsChange('wakeTime', ids)}
            chartKind="line"
            unitOfObservation="night"
            trace={sleepTrace}
            emptyMessage={sleepEmpty}
          />
        )
    }

    if (sectionId === SCREEN_TIME_SECTION_ID) {
      const days = inRange(screenTime.daily, range)
      const shown = new Set(days.map((day) => day.date))
      const inRangeSeries = screenTimeObservations(
        data.screenTime.filter((sample) => shown.has(String(sample.metadata?.localDate))),
      )
      const parts = [
        inRangeSeries.phoneDays > 0 ? t.screenTime.fromPhone(inRangeSeries.phoneDays) : null,
        inRangeSeries.fileDays > 0 ? t.screenTime.fromFiles(inRangeSeries.fileDays) : null,
      ].filter(Boolean)
      const trace = t.screenTime.trace(days.length, parts.join(', '), inRangeSeries.bothDays)

      const chosen = chosenNames(data.screenTimeApps)
      const chooser = (
        <ItemChooser
          items={appUsageTotals(data.screenTime, range).map((app) => ({ name: app.name, detail: formatDuration(app.seconds * 1000) }))}
          chosen={chosen}
          max={MAX_CHOSEN_APPS}
          texts={{ ...t.screenTime.chooser, hint: t.screenTime.chooser.hint(MAX_CHOSEN_APPS) }}
          onToggle={(name) => onScreenTimeAppsChange(toggleChosenApp(data.screenTimeApps, name))}
          onClear={() => onScreenTimeAppsChange([])}
          open={appListOpen}
          onOpenChange={setAppListOpen}
        />
      )
      const common = {
        subject: 'stopwatch' as const,
        range,
        aggregation,
        target: null,
        metricIds: metricsOf(SCREEN_TIME_SECTION_ID),
        onMetricsChange: (ids: string[]) => onMetricsChange(SCREEN_TIME_SECTION_ID, ids),
        chartKind: 'bar' as const,
        unitOfObservation: 'day' as const,
        emptyMessage: t.screenTime.empty,
      }
      if (chosen.length > 0) {
        return (
          <ScreenTimeAppsSection
            key={SCREEN_TIME_SECTION_ID}
            slots={data.screenTimeApps}
            samples={data.screenTime}
            range={range}
            aggregation={aggregation}
            order={order}
            controls={chooser}
            trace={t.screenTime.appsTrace(trace)}
            metricIds={metricsOf(SCREEN_TIME_SECTION_ID)}
            onMetricsChange={(ids) => onMetricsChange(SCREEN_TIME_SECTION_ID, ids)}
          />
        )
      }
      return (
        <NumericSection
          key={SCREEN_TIME_SECTION_ID}
          order={order}
          title={t.screenTime.title}
          description={t.screenTime.description}
          daily={screenTime.daily}
          controls={chooser}
          trace={trace}
          {...common}
        />
      )
    }

    if (sectionId === 'ynab:spending') {
      const localToday = today(data)
      const spending = spendingSummary(data.ynab, localToday > range.end ? range.end : localToday, range)
      const money = (amount: number) => `${formatNumber(amount, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${spending.currency ? ` ${spending.currency}` : ''}`
      const top = spending.byCategory.slice(0, 5).map((category) => `${category.name} ${money(category.amount)}`)
      const lastDay = localToday > range.end ? range.end : localToday
      const chosenCategories = chosenNames(data.ynabCategories)
      const byCategory = spendingByCategory(data.ynab, lastDay)
      // Chosen categories: their own colour slots (stable when one is removed);
      // otherwise the biggest categories over all data + Other.
      const shownSeries = chosenCategories.length > 0 ? spendingForCategories(data.ynab, lastDay, chosenCategories) : byCategory.series
      const categorySeries: ChartSeries[] = chosenCategories.length > 0
        ? chosenCategories.map((name) => ({ key: name, label: name, colorSlot: data.ynabCategories.indexOf(name) }))
        : byCategory.categories.map((name, slot) => ({ key: name, label: name, colorSlot: name === OTHER_CATEGORY ? 'other' : slot }))
      const categoryRows = aggregateMany(shownSeries, range, aggregation)
      const categoryChooser = (
        <ItemChooser
          items={spending.byCategory.map((category) => ({ name: category.name, detail: money(category.amount) }))}
          chosen={chosenCategories}
          max={MAX_CHOSEN_CATEGORIES}
          texts={{ ...t.spending.chooser, hint: t.spending.chooser.hint(MAX_CHOSEN_CATEGORIES) }}
          onToggle={(name) => onYnabCategoriesChange(toggleSlot(data.ynabCategories, name, MAX_CHOSEN_CATEGORIES))}
          onClear={() => onYnabCategoriesChange([])}
          open={categoryListOpen}
          onOpenChange={setCategoryListOpen}
        />
      )
      return (
        <NumericSection
          key={sectionId}
          order={order}
          title={t.spending.title}
          description={chosenCategories.length > 0 ? t.spending.descriptionChosen : t.spending.descriptionAll}
          subject="number"
          unit={spending.currency}
          daily={chosenCategories.length > 0 ? sumSeries(shownSeries) : spending.daily}
          controls={categoryChooser}
          range={range}
          aggregation={aggregation}
          target={null}
          metricIds={metricsOf(sectionId)}
          onMetricsChange={(ids) => onMetricsChange(sectionId, ids)}
          chartKind="bar"
          unitOfObservation="day"
          chart={categorySeries.length > 0 ? (
            <MultiSeriesChart
              rows={categoryRows}
              series={categorySeries}
              kind="stacked"
              aggregation={aggregation}
              title={t.spending.byCategory}
              formatValue={money}
              formatTick={(value) => formatNumber(value, { maximumFractionDigits: 0 })}
            />
          ) : undefined}
          afterTable={categorySeries.length > 0 ? (
            <MultiSeriesTable rows={categoryRows} series={categorySeries} aggregation={aggregation} caption={t.spending.byCategory} formatValue={money} label={t.spending.showDataByCategory} />
          ) : undefined}
          trace={t.spending.trace(chosenCategories.length > 0, byCategory.categories.includes(OTHER_CATEGORY), top.join(', '))}
          emptyMessage={t.spending.empty}
        />
      )
    }

    if (sectionId === 'health:exercise') {
      const summary = exerciseSummary(data.health, range)
      const types = summary.byType.slice(0, 4).map((type) => t.exercise.type(type.name, formatDuration(type.seconds * 1000), type.sessions))
      return (
        <NumericSection
          key={sectionId}
          order={order}
          title={t.exercise.title}
          description={t.exercise.description}
          subject="stopwatch"
          daily={summary.daily}
          range={range}
          aggregation={aggregation}
          target={null}
          metricIds={metricsOf(sectionId)}
          onMetricsChange={(ids) => onMetricsChange(sectionId, ids)}
          chartKind="bar"
          unitOfObservation="day"
          trace={t.exercise.trace(summary.sessions, types.join(', '))}
          emptyMessage={t.exercise.empty}
        />
      )
    }

    if (sectionId.startsWith('health:')) {
      const kind = sectionId.slice('health:'.length) as HealthKind
      const series = healthSeries(data.health, kind, range)
      const others = series.origins.filter((origin) => origin !== series.origin)
      return (
        <NumericSection
          key={sectionId}
          order={order}
          title={HEALTH_LABELS[kind]}
          description={t.health.descriptions[kind]}
          subject="number"
          unit={t.health.units[kind]}
          daily={series.daily}
          range={range}
          aggregation={aggregation}
          target={null}
          metricIds={metricsOf(sectionId)}
          onMetricsChange={(ids) => onMetricsChange(sectionId, ids)}
          chartKind={kind === 'steps' || kind === 'distance' ? 'bar' : 'line'}
          unitOfObservation="day"
          trace={t.health.trace(series.origin, others.join(', '))}
          emptyMessage={t.health.empty}
        />
      )
    }

    if (sectionId.startsWith('formula:')) {
      const formula = data.formulas.find((item) => `formula:${item.id}` === sectionId)
      if (!formula) return null
      const series = formulaDaily(formula, baseMeasures)
      const daily = series.status === 'ok' ? series.daily : []
      const days = inRange(daily, range).length
      return (
        <NumericSection
          key={sectionId}
          order={order}
          title={formula.name}
          description={t.formula.description}
          subject={formula.display === 'duration' ? 'stopwatch' : 'number'}
          unit={formula.display === 'number' ? formula.unit : null}
          daily={daily}
          range={range}
          aggregation={aggregation}
          target={null}
          metricIds={metricsOf(sectionId)}
          onMetricsChange={(ids) => onMetricsChange(sectionId, ids)}
          chartKind="bar"
          unitOfObservation="day"
          trace={t.formula.trace(days)}
          emptyMessage={
            series.status === 'missing-measures'
              ? t.formula.missingMeasures
              : series.status === 'invalid'
                ? t.formula.invalid(series.reason)
                : t.formula.empty
          }
        />
      )
    }

    if (sectionId === LOCATION_SECTION_ID) {
      const measure = data.locationMeasure
      const view = LOCATION_VIEWS[measure]
      const viewText = t.location.views[measure]
      const places = listPlaces(data.location)
      const awayPlace =
        places.find((place) => place.key === data.awayPlace) ?? places.find((place) => place.isHome) ?? places[0]
      const placeView = measure === 'away' || measure === 'in'
      const daily =
        measure === 'away' ? (awayPlace ? awayFromSeries(location, awayPlace.key) : [])
        : measure === 'in' ? (awayPlace ? timeInSeries(location, awayPlace.key) : [])
        : location.daily[measure]
      const awayName = awayPlace ? placeLabel(awayPlace, data.placeNames) : t.location.aPlace
      const days = inRange(daily, range)
      const recordedInRange = [...location.byDay.entries()].filter(([date]) => date >= range.start && date <= range.end)
      const partial = location.partialDays.filter((date) => date >= range.start && date <= range.end).length
      const unlocated = (placeView || measure === 'places')
        ? location.unlocatedDays.filter((date) => date >= range.start && date <= range.end).length
        : 0
      const countInRange = (map: Map<string, number>) => [...map.entries()]
        .filter(([date]) => date >= range.start && date <= range.end && location.byDay.has(date))
        .reduce((sum, [, count]) => sum + count, 0)
      const stillInRange = countInRange(location.stillMovements)
      const stillPlaced = countInRange(location.stillAttributed)
      const clockNotes = [...location.clockChanges.entries()]
        .filter(([date]) => date >= range.start && date <= range.end)
        .map(([date, hours]) =>
          t.location.clockChange(`${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`, hours > 24, hours))
        .join('')
      const trace =
        t.location.basedOn(days.length) +
        (partial > 0 ? t.location.partial(partial) : '') +
        (unlocated > 0 ? t.location.unlocated(unlocated) : '') +
        t.location.calendarDays +
        (stillInRange > 0 && measure !== 'distance'
          ? t.location.motionless(stillInRange) +
            (stillPlaced > 0 ? t.location.motionlessPlaced(stillPlaced, stillInRange) : '') + '.'
          : '') +
        clockNotes

      const extraTiles = []
      if (measure === 'distance') {
        const totals = MODE_GROUPS.map((group) => [group, recordedInRange.reduce((sum, [, day]) => sum + day.distanceByGroup[group], 0)] as const)
        const all = totals.reduce((sum, [, km]) => sum + km, 0)
        const top = [...totals].sort((a, b) => b[1] - a[1])[0]
        extraTiles.push({
          id: 'extra:location-modes',
          description: t.location.modesDescription,
          label: t.location.modesLabel,
          value: all > 0 ? `${MODE_GROUP_LABELS[top[0]]} ${Math.round((top[1] / all) * 100)} %` : '—',
          note: totals.filter(([, km]) => km > 0).map(([group, km]) => `${MODE_GROUP_LABELS[group]} ${km.toFixed(1)} km`).join(' · ') || t.location.noMovements,
        })
      }
      if (measure === 'active') {
        const km = recordedInRange.reduce((sum, [, day]) => sum + day.distanceByGroup.cycling + day.distanceByGroup.walking, 0)
        extraTiles.push({
          id: 'extra:location-active-distance',
          description: t.location.activeDistanceDescription,
          label: t.location.activeDistanceLabel,
          value: `${km.toFixed(1)} km`,
          note: t.location.recordedDays(recordedInRange.length),
        })
      }

      return (
        <NumericSection
          key={LOCATION_SECTION_ID}
          order={order}
          title={t.location.title}
          description={
            measure === 'away' ? t.location.timeAwayFrom(awayName, viewText.description)
            : measure === 'in' ? t.location.timeIn(awayName, viewText.description)
            : t.location.view(viewText.label, viewText.description)
          }
          controls={
            <>
              <label className="flex items-center gap-2 text-sm">
              <span className="text-xs font-medium text-slate-600">{t.location.show}</span>
              <select
                value={measure}
                onChange={(event) => onLocationMeasureChange(event.target.value as LocationMeasure)}
                className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
              >
                {LOCATION_MEASURES.map((item) => (
                  <option key={item} value={item}>{t.location.views[item].label}</option>
                ))}
              </select>
              </label>
              {placeView && awayPlace && (
                <AwayPlaceControls
                  label={measure === 'in' ? t.location.in : t.location.from}
                  places={places}
                  selectedKey={awayPlace.key}
                  names={data.placeNames}
                  onSelect={onAwayPlaceChange}
                  onRename={onPlaceRename}
                />
              )}
            </>
          }
          subject={view.subject}
          unit={view.unit}
          daily={daily}
          range={range}
          aggregation={aggregation}
          target={null}
          metricIds={metricsOf(`location:${measure}`)}
          onMetricsChange={(ids) => onMetricsChange(`location:${measure}`, ids)}
          chartKind="bar"
          unitOfObservation="day"
          extraTiles={extraTiles}
          trace={trace}
          emptyMessage={
            placeView && !awayPlace
              ? t.location.noPlaces
              : t.location.empty
          }
        />
      )
    }

    const habit = habitsById.get(sectionId.slice('habit:'.length))
    if (!habit) return null
    const entries = data.entries.filter((entry) => entry.habitId === habit.id)

    if (habit.type === 'label' || habit.type === 'text') {
      return (
        <CountsSection
          key={habit.id}
          title={habit.name}
          kind={habit.type}
          values={habitTextValues(habit, entries, data.displayTimezone)}
          options={habit.type === 'label' ? habit.labelOptions : []}
          range={range}
          order={order}
        />
      )
    }

    const daily = habitDailyObservations(habit, entries, data.displayTimezone)
    const daysInRange = inRange(daily, range)
    // Same date rule as the daily values (display timezone).
    const entryCount = entries.filter((entry) => {
      const date = entryDate(entry, data.displayTimezone)
      return date >= range.start && date <= range.end
    }).length

    if (habit.type === 'checkbox') {
      return (
        <CheckboxSection
          key={habit.id}
          title={habit.name}
          daily={daily}
          range={range}
          aggregation={aggregation}
          entryCount={entryCount}
          order={order}
        />
      )
    }

    const trace = t.habits.basedOn(daysInRange.length, entryCount) +
      (habit.type === 'number' ? t.habits.dailyNumber(habit.dailyAggregation === 'mean') : t.habits.dailyStopwatch)

    const stopwatch = habit.type === 'stopwatch'
      ? stopwatchSummary(daysInRange.map((o) => ({ date: o.date, durationMs: (o.value ?? 0) * 3_600_000 })))
      : null

    return (
      <NumericSection
        key={habit.id}
        order={order}
        title={habit.name}
        description={habit.type === 'number' ? t.habits.numberDescription(habit.unit) : t.habits.stopwatchDescription}
        subject={habit.type}
        unit={habit.type === 'number' ? habit.unit : null}
        daily={daily}
        range={range}
        aggregation={aggregation}
        target={habit.type === 'number' ? habit.target : null}
        metricIds={metricsOf(sectionId)}
        onMetricsChange={(ids) => onMetricsChange(sectionId, ids)}
        chartKind="bar"
        unitOfObservation="day"
        extraTiles={stopwatch ? [
          {
            id: 'extra:stopwatch-total',
            description: t.habits.totalTimeDescription,
            label: t.habits.totalTimeLabel,
            value: formatDuration(stopwatch.totalMs),
            note: t.habits.sessions(stopwatch.sessions),
          },
          {
            id: 'extra:stopwatch-mean-per-day',
            description: t.habits.meanPerDayDescription,
            label: t.habits.meanPerDayLabel,
            value: stopwatch.meanPerValidDayMs === null ? '—' : formatDuration(stopwatch.meanPerValidDayMs),
            note: t.habits.days(stopwatch.validDays),
          },
        ] : []}
        trace={trace}
        emptyMessage={t.habits.empty}
      />
    )
  }

  return (
    <div className="space-y-6">
      <PanelVisibilityControls panels={panels} hidden={hidden} onChange={setPanelHidden} onShowAll={() => onHiddenChange([])} />

      {visible.map((sectionId, index) => renderSection(sectionId, orderFor(index)))}

      {visible.length === 0 && arranged.length > 0 && (
        <p className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-8 text-center text-sm text-slate-500">
          {t.allHidden}
        </p>
      )}

      {data.habits.length === 0 && (
        <p className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-8 text-center text-sm text-slate-500">
          {t.noActiveHabits}
        </p>
      )}
    </div>
  )
}
