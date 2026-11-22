import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { db } from '../../database/db'
import { createEntry } from '../../database/entries'
import { createHabit } from '../../database/habits'
import { createManualSleepSession } from '../../database/sleepSessions'
import { saveSectionMetrics, STATISTIC_IDS } from '../../settings/dashboardMetrics'
import { saveSleepTargets } from '../../settings/sleepTargets'
import { buildScreenTimeDedupeKey } from '../../screenTime/screenTime'
import { planLocationImport } from '../../import/locationImport'
import { movement, timelineJson, visit } from '../../import/testTimeline'
import { screenTimeSample } from '../../screenTime/testScreenTime'
import { buildDailySamples, buildExerciseSamples } from '../../healthData/healthData'
import { transactionSample } from '../../ynab/ynabImport'
import { localDateTimeToUtc } from '../../time/time'

import Dashboard from './Dashboard'

// "Today" is 10 November 2026 (tests run in America/New_York).
const NOW = Date.parse('2026-11-10T17:00:00.000Z')

async function logNight(date: string, bed: string, wakeDate: string, wake: string) {
  await createManualSleepSession({
    startUtc: localDateTimeToUtc(`${date}T${bed}`, 'Europe/Paris').utc,
    endUtc: localDateTimeToUtc(`${wakeDate}T${wake}`, 'Europe/Paris').utc,
    timezone: 'Europe/Paris',
  })
}

/** Five nights 3–7 Nov, 23:00–07:00 Paris, plus one 23:30–06:30. */
async function logWeek() {
  for (const day of [3, 4, 5, 6]) {
    await logNight(`2026-11-0${day}`, '23:00', `2026-11-0${day + 1}`, '07:00')
  }
  await logNight('2026-11-07', '23:30', '2026-11-08', '06:30')
}

function section(name: string): HTMLElement {
  return screen.getByRole('region', { name })
}

describe('Dashboard', () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    await db.delete()
    await db.open()
  })

  afterEach(async () => {
    cleanup()
    vi.useRealTimers()
    db.close()
    await db.delete()
  })

  it('explains what to do when there is no data', async () => {
    render(<Dashboard />)

    expect(await screen.findByText('Nothing to show yet. Log sleep or create habits in Data Logging.')).toBeInTheDocument()
  })

  it('shows sleep duration, bedtime and wake time first, then habits', async () => {
    await logWeek()
    await createHabit({ name: 'Water', type: 'number', unit: 'ml' })

    render(<Dashboard />)

    await screen.findByRole('region', { name: 'Sleep duration' })
    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
    expect(headings).toEqual(['Sleep duration', 'Bedtime', 'Wake time', 'Water'])
    expect(screen.getByRole('navigation', { name: 'Move through periods' })).toHaveTextContent(/11 Oct – 9 Nov 2026|12 Oct – 10 Nov 2026/)
  })

  it('shows only n, the mean and the change by default; the rest can be chosen', async () => {
    await logWeek()

    render(<Dashboard />)

    const sleep = await screen.findByRole('region', { name: 'Sleep duration' })
    const tiles = within(sleep).getAllByRole('term').map((term) => term.textContent)
    expect(tiles).toEqual(['Nights with data', 'Mean', 'Change vs previous 30 days'])

    await userEvent.click(within(sleep).getByText(/Choose what to show \(2 shown\)/))
    await userEvent.click(within(sleep).getByLabelText(/^Median/))

    expect(await within(sleep).findByText('Median', { selector: 'dt' })).toBeInTheDocument()
    expect(JSON.parse((await db.settings.get('dashboard.metrics'))?.value ?? '{}')).toEqual({
      sleepDuration: ['choice:v2', 'stat:mean', 'stat:median', 'stat:change'],
    })
  })

  it('computes nightly statistics with traceability', async () => {
    await logWeek()
    await saveSectionMetrics('sleepDuration', [...STATISTIC_IDS])
    await saveSectionMetrics('bedtime', [...STATISTIC_IDS])

    render(<Dashboard />)

    const sleep = await screen.findByRole('region', { name: 'Sleep duration' })

    // 4 nights of 8 h and one of 7 h → mean 7 h 48 min, median 8 h
    expect(within(sleep).getByText('Nights with data', { selector: 'dt' }).nextSibling).toHaveTextContent('5')
    expect(within(sleep).getByText('Mean', { selector: 'dt' }).nextSibling).toHaveTextContent('7 h 48 min')
    expect(within(sleep).getByText('Median', { selector: 'dt' }).nextSibling).toHaveTextContent('8 h 00 min')
    expect(within(sleep).getByText(/Based on 5 nights from 5 sleep sessions \(sleep duration: 5 from time in bed\)/)).toBeInTheDocument()

    const bedtime = section('Bedtime')
    // 23:00 ×4 and 23:30 → mean 23:06
    expect(within(bedtime).getByText('Mean', { selector: 'dt' }).nextSibling).toHaveTextContent('23:06')
    // Clock-time deviations are shown in minutes.
    expect(within(bedtime).getByText('IQR', { selector: 'dt' }).nextSibling).toHaveTextContent('0 min')
  })

  it('shows "Insufficient data" below 5 nights but always shows n', async () => {
    await logNight('2026-11-07', '23:00', '2026-11-08', '07:00')

    render(<Dashboard />)

    const sleep = await screen.findByRole('region', { name: 'Sleep duration' })
    expect(within(sleep).getByText('Nights with data', { selector: 'dt' }).nextSibling).toHaveTextContent('1')
    expect(within(sleep).getAllByText('Insufficient data').length).toBeGreaterThan(0)
    expect(within(sleep).queryByText('Mean', { selector: 'dt' })).not.toBeInTheDocument()
  })

  it('uses the sleep targets for RMSD, bias and spread', async () => {
    await logWeek()
    await saveSleepTargets({ sleepDuration: '8:00', bedtime: '23:00', wakeTime: '' })
    await saveSectionMetrics('sleepDuration', ['stat:rmsd'])

    render(<Dashboard />)

    const sleep = await screen.findByRole('region', { name: 'Sleep duration' })
    expect(within(sleep).getByText('Around the target (8 h 00 min)')).toBeInTheDocument()
    // Mean 7.8 h − 8 h = −12 min
    expect(within(sleep).getByText('Bias', { selector: 'dt' }).nextSibling).toHaveTextContent('−12 min')
  })

  it('groups the data table by week and lets the range change', async () => {
    await logWeek()

    render(<Dashboard />)

    const sleep = await screen.findByRole('region', { name: 'Sleep duration' })
    await userEvent.click(screen.getByRole('button', { name: '7 days' }))
    expect(screen.getByRole('navigation', { name: 'Move through periods' })).toHaveTextContent('4 Nov – 10 Nov 2026')

    await userEvent.selectOptions(screen.getByLabelText('Group by'), 'week')
    await userEvent.click(within(sleep).getByText(/Show data/))

    const rows = within(within(sleep).getByRole('table')).getAllByRole('row').slice(1)
    // Week of Mon 2 Nov (nights 4–7 Nov in range) and week of Mon 9 Nov (no nights)
    expect(rows.map((row) => row.textContent)).toEqual([
      'Week of 2 Nov 20267 h 45 min4',
      'Week of 9 Nov 2026No data0',
    ])
  })

  it('refuses an invalid custom range', async () => {
    await logWeek()

    render(<Dashboard />)

    await userEvent.click(await screen.findByRole('button', { name: 'Custom' }))
    expect(screen.getByText('Enter a start and end date (dd/mm/yyyy) for the custom range.')).toBeInTheDocument()

    await userEvent.type(screen.getByLabelText('From'), '07/11/2026')
    await userEvent.type(screen.getByLabelText('To'), '03/11/2026')
    expect(screen.getByText('The end date must be on or after the start date.')).toBeInTheDocument()

    // Correct both dates: the range becomes 3–7 November.
    await userEvent.clear(screen.getByLabelText('From'))
    await userEvent.type(screen.getByLabelText('From'), '03/11/2026')
    await userEvent.clear(screen.getByLabelText('To'))
    await userEvent.type(screen.getByLabelText('To'), '07/11/2026')
    await vi.waitFor(() => expect(screen.getByRole('navigation', { name: 'Move through periods' })).toHaveTextContent('3 Nov – 7 Nov 2026'))
  })

  it('saves the metrics chosen for a section', async () => {
    await logWeek()

    render(<Dashboard />)

    const bedtime = await screen.findByRole('region', { name: 'Bedtime' })
    await userEvent.click(within(bedtime).getByText(/Choose what to show/))
    await userEvent.click(within(bedtime).getByLabelText(/Percentiles/))

    expect(await within(bedtime).findByText('P10 23:00 · P25 23:00 · P50 23:00 · P75 23:00 · P90 23:18')).toBeInTheDocument()
    expect(JSON.parse((await db.settings.get('dashboard.metrics'))?.value ?? '{}')).toEqual({
      bedtime: ['choice:v2', 'stat:mean', 'stat:change', 'percentiles'],
    })
  })

  it('re-arranges habits with the up / down buttons (shared habit order)', async () => {
    const water = await createHabit({ name: 'Water', type: 'number', unit: 'ml' })
    const gym = await createHabit({ name: 'Gym', type: 'checkbox' })
    const mood = await createHabit({ name: 'Mood', type: 'label', labelOptions: ['Good', 'Bad'] })
    const onHabitsReordered = vi.fn()

    render(<Dashboard onHabitsReordered={onHabitsReordered} />)

    await screen.findByRole('region', { name: 'Water' })
    const habitHeadings = () => screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent).slice(3)
    expect(habitHeadings()).toEqual(['Water', 'Gym', 'Mood'])
    expect(screen.getByRole('button', { name: 'Move Sleep duration up' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Move Mood down' })).toBeDisabled()

    await userEvent.click(screen.getByRole('button', { name: 'Move Mood up' }))

    // Saved first, then shown.
    await vi.waitFor(() => expect(habitHeadings()).toEqual(['Water', 'Mood', 'Gym']))
    const stored = await db.habits.toArray()
    const position = (id: string) => stored.find((habit) => habit.id === id)?.sortOrder
    expect([position(water.id), position(mood.id), position(gym.id)]).toEqual([0, 1, 2])
    expect(onHabitsReordered).toHaveBeenCalledTimes(1)

    await userEvent.click(screen.getByRole('button', { name: 'Move Water down' }))
    await vi.waitFor(() => expect(habitHeadings()).toEqual(['Mood', 'Water', 'Gym']))
  })

  it('moves through periods with arrows and swipes, never past today', async () => {
    await logWeek()
    const user = userEvent.setup()
    render(<Dashboard />)
    await screen.findByRole('region', { name: 'Sleep duration' })
    const nav = () => screen.getByRole('navigation', { name: 'Move through periods' })
    await user.click(screen.getByRole('button', { name: '7 days' }))
    expect(nav()).toHaveTextContent('4 Nov – 10 Nov 2026')
    expect(screen.getByRole('button', { name: 'Next 7 days' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Previous 7 days' }))
    expect(nav()).toHaveTextContent('28 Oct – 3 Nov 2026')
    await user.click(screen.getByRole('button', { name: '1 day later' }))
    expect(nav()).toHaveTextContent('29 Oct – 4 Nov 2026')

    // A long swipe to the left = the next whole period, stopping at today.
    const area = screen.getByRole('region', { name: 'Sleep duration' })
    // (The test screen is 1024 px wide: a long swipe is at least 35 % = 358 px.)
    fireEvent.touchStart(area, { touches: [{ clientX: 450, clientY: 300 }] })
    fireEvent.touchEnd(area, { changedTouches: [{ clientX: 20, clientY: 310 }] })
    expect(nav()).toHaveTextContent('4 Nov – 10 Nov 2026')
    // A short swipe to the right = 1 day earlier.
    fireEvent.touchStart(area, { touches: [{ clientX: 100, clientY: 300 }] })
    fireEvent.touchEnd(area, { changedTouches: [{ clientX: 170, clientY: 305 }] })
    expect(nav()).toHaveTextContent('3 Nov – 9 Nov 2026')
    // Scrolling (mostly vertical) changes nothing.
    fireEvent.touchStart(area, { touches: [{ clientX: 100, clientY: 300 }] })
    fireEvent.touchEnd(area, { changedTouches: [{ clientX: 160, clientY: 500 }] })
    expect(nav()).toHaveTextContent('3 Nov – 9 Nov 2026')

    await user.click(screen.getByRole('button', { name: 'Back to today' }))
    expect(nav()).toHaveTextContent('4 Nov – 10 Nov 2026')
    expect(screen.queryByRole('button', { name: 'Back to today' })).not.toBeInTheDocument()
  })

  it('arrows move a custom range by changing its dates', async () => {
    await logWeek()
    const user = userEvent.setup()
    render(<Dashboard />)
    await screen.findByRole('region', { name: 'Sleep duration' })
    await user.click(screen.getByRole('button', { name: 'Custom' }))
    await user.type(screen.getByLabelText('From'), '01/11/2026')
    await user.type(screen.getByLabelText('To'), '07/11/2026')
    await user.click(screen.getByRole('button', { name: 'Previous 7 days' }))
    expect(screen.getByLabelText('From')).toHaveValue('25/10/2026')
    expect(screen.getByLabelText('To')).toHaveValue('31/10/2026')
  })

  it('hides and shows panels; the choice is saved, kept and nothing is deleted', async () => {
    await logWeek()
    await createHabit({ name: 'Water', type: 'number', unit: 'ml' })
    const user = userEvent.setup()
    const { unmount } = render(<Dashboard />)
    await screen.findByRole('region', { name: 'Water' })
    const headings = () => screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
    expect(headings()).toEqual(['Sleep duration', 'Bedtime', 'Wake time', 'Water'])

    await user.click(screen.getByText('Show or hide panels'))
    await user.click(screen.getByRole('checkbox', { name: 'Bedtime' }))
    await user.click(screen.getByRole('checkbox', { name: 'Water' }))
    await vi.waitFor(() => expect(headings()).toEqual(['Sleep duration', 'Wake time']))
    expect(screen.getByText('Show or hide panels (2 hidden)')).toBeInTheDocument()
    expect(JSON.parse((await db.settings.get('dashboard.hidden'))?.value ?? 'null')).toEqual([
      'bedtime', 'habit:' + (await db.habits.toArray())[0].id,
    ])

    // Moving skips hidden panels: Wake time goes above Sleep duration.
    await user.click(screen.getByRole('button', { name: 'Move Wake time up' }))
    await vi.waitFor(() => expect(headings()).toEqual(['Wake time', 'Sleep duration']))
    expect(screen.getByRole('button', { name: 'Move Sleep duration down' })).toBeDisabled()

    // Kept after reopening the Dashboard.
    unmount()
    render(<Dashboard />)
    await screen.findByRole('region', { name: 'Wake time' })
    expect(headings()).toEqual(['Wake time', 'Sleep duration'])

    await user.click(screen.getByText('Show or hide panels (2 hidden)'))
    await user.click(screen.getByRole('button', { name: 'Show all' }))
    await vi.waitFor(() => expect(headings()).toHaveLength(4))
    expect(headings()).toContain('Water')
    expect(await db.habits.count()).toBe(1)
  })

  it('says so when every panel is hidden', async () => {
    await createHabit({ name: 'Water', type: 'number', unit: 'ml' })
    const user = userEvent.setup()
    render(<Dashboard />)
    await screen.findByRole('region', { name: 'Water' })
    await user.click(screen.getByText('Show or hide panels'))
    for (const name of ['Sleep duration', 'Bedtime', 'Wake time', 'Water']) {
      await user.click(screen.getByRole('checkbox', { name }))
    }
    expect(await screen.findByText(/All panels are hidden/)).toBeInTheDocument()
  })

  it('re-arranges sleep sections and habits freely; the layout is saved and kept', async () => {
    await logWeek()
    await createHabit({ name: 'Water', type: 'number', unit: 'ml' })
    const onHabitsReordered = vi.fn()

    const { unmount } = render(<Dashboard onHabitsReordered={onHabitsReordered} />)
    await screen.findByRole('region', { name: 'Water' })
    const headings = () => screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)

    await userEvent.click(screen.getByRole('button', { name: 'Move Bedtime up' }))
    await vi.waitFor(() => expect(headings()).toEqual(['Bedtime', 'Sleep duration', 'Wake time', 'Water']))

    await userEvent.click(screen.getByRole('button', { name: 'Move Water up' }))
    await vi.waitFor(() => expect(headings()).toEqual(['Bedtime', 'Sleep duration', 'Water', 'Wake time']))

    expect(JSON.parse((await db.settings.get('dashboard.order'))?.value ?? 'null')).toEqual([
      'bedtime', 'sleepDuration', 'habit:' + (await db.habits.toArray())[0].id, 'wakeTime',
    ])
    expect(onHabitsReordered).not.toHaveBeenCalled() // no habit order change

    unmount()
    render(<Dashboard />)
    await screen.findByRole('region', { name: 'Water' })
    expect(headings()).toEqual(['Bedtime', 'Sleep duration', 'Water', 'Wake time'])
  })

  it('summarises number, checkbox and label habits', async () => {
    const water = await createHabit({ name: 'Water', type: 'number', unit: 'ml', target: 2000 })
    const gym = await createHabit({ name: 'Gym', type: 'checkbox' })
    const mood = await createHabit({ name: 'Mood', type: 'label', labelOptions: ['Good', 'Bad'] })

    for (const [day, ml] of [[5, 1000], [6, 2000], [7, 3000], [8, 2000], [9, 2000]] as const) {
      await createEntry({ habitId: water.id, value: ml, occurredStart: `2026-11-0${day}T15:00:00.000Z` })
    }
    await createEntry({ habitId: water.id, value: 500, occurredStart: '2026-11-09T16:00:00.000Z' })
    await createEntry({ habitId: gym.id, value: true, occurredStart: '2026-11-08T15:00:00.000Z' })
    await createEntry({ habitId: gym.id, value: false, occurredStart: '2026-11-09T15:00:00.000Z' })
    await createEntry({ habitId: mood.id, value: 'Good', occurredStart: '2026-11-09T15:00:00.000Z' })
    await saveSectionMetrics(`habit:${water.id}`, ['stat:mean', 'stat:rmsd'])

    render(<Dashboard />)

    const waterSection = await screen.findByRole('region', { name: 'Water' })
    // Daily totals 1000, 2000, 3000, 2000, 2500 → mean 2,100 ml
    expect(within(waterSection).getByText('Mean', { selector: 'dt' }).nextSibling).toHaveTextContent('2,100 ml')
    expect(within(waterSection).getByText(/Based on 5 days with entries \(6 entries\)\. Daily value: total/)).toBeInTheDocument()
    expect(within(waterSection).getByText('Around the target (2,000 ml)')).toBeInTheDocument()

    const gymSection = section('Gym')
    expect(within(gymSection).getByText('Completion rate', { selector: 'dt' }).nextSibling).toHaveTextContent('50 %')

    const moodSection = section('Mood')
    expect(within(moodSection).getByText('Most frequent', { selector: 'dt' }).nextSibling).toHaveTextContent('Good')
  })

  describe('screen time', () => {
    it('shows a Screen time section last, with one value per day (phone preferred)', async () => {
      await logWeek()
      await createHabit({ name: 'Water', type: 'number', unit: 'ml' })
      await db.externalSamples.bulkAdd([
        screenTimeSample('f-7', '2026-11-07', { value: 7200 }),
        screenTimeSample('f-8', '2026-11-08', { value: 3600 }),
        screenTimeSample('p-8', '2026-11-08', {
          source: 'android_usage',
          dedupeKey: buildScreenTimeDedupeKey('android_usage', '2026-11-08'),
          value: 5400,
        }),
      ])

      render(<Dashboard />)

      const screenTime = await screen.findByRole('region', { name: 'Screen time' })
      const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
      expect(headings).toEqual(['Sleep duration', 'Bedtime', 'Wake time', 'Water', 'Screen time'])
      expect(within(screenTime).getByText(
        "Based on 2 days (1 day from the phone, 1 day from App Usage files). On 1 day both exist; the phone's figure is used. Days without a record are missing, not zero.",
      )).toBeInTheDocument()

      await userEvent.click(within(screenTime).getByText(/Show data/))
      const rows = within(within(screenTime).getByRole('table')).getAllByRole('row').slice(1)
      expect(rows.map((row) => row.textContent)).toEqual(
        expect.arrayContaining([expect.stringMatching(/^7 Nov 2026.*2 h 00 min/), expect.stringMatching(/^8 Nov 2026.*1 h 30 min/)]),
      )
    })

    it('shows several apps together in one chart, each in its own colour; the choice is kept', async () => {
      const apps = (list: [string, number][]) => ({ format: 1, localDate: '', apps: list.map(([name, seconds]) => ({ name, seconds, opens: null })) })
      await db.externalSamples.bulkAdd([
        screenTimeSample('f-7', '2026-11-07', { value: 4200, metadata: { ...apps([['Chat', 3600], ['Maps', 600]]), localDate: '2026-11-07' } }),
        screenTimeSample('f-8', '2026-11-08', { value: 1800, metadata: { ...apps([['Maps', 1800]]), localDate: '2026-11-08' } }),
      ])
      const user = userEvent.setup()
      const { unmount } = render(<Dashboard />)
      const total = await screen.findByRole('region', { name: 'Screen time' })
      expect(within(total).getByText('total screen time')).toBeInTheDocument()

      await user.click(within(total).getByRole('button', { name: 'Choose apps…' }))
      // Most used first (Chat 1 h; Maps 10 + 30 = 40 min).
      expect(within(screen.getByRole('list', { name: 'Apps' })).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Chat1 h 00 min', 'Maps40 min'])

      await user.click(within(screen.getByRole('list', { name: 'Apps' })).getByRole('checkbox', { name: /Chat/ }))
      // The list stays open while the panel switches to the apps chart.
      await screen.findByRole('region', { name: 'Screen time by app' })
      await user.click(within(screen.getByRole('list', { name: 'Apps' })).getByRole('checkbox', { name: /Maps/ }))

      const merged = await screen.findByRole('region', { name: 'Screen time by app' })
      expect(screen.queryByRole('region', { name: 'Screen time' })).not.toBeInTheDocument()
      await vi.waitFor(() => expect(within(within(merged).getByRole('list', { name: 'Legend' })).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Chat', 'Maps']))
      // Statistics per app: 2 recorded days; 8 Nov counts 0 for Chat (recorded, not used).
      expect(within(merged).getByRole('group', { name: 'Statistics for Chat' })).toHaveTextContent('Total 1 h 00 min · used 1 of 2 recorded days')
      expect(within(merged).getByRole('group', { name: 'Statistics for Maps' })).toHaveTextContent('Total 40 min · used 2 of 2 recorded days')
      expect(within(within(merged).getByRole('group', { name: 'Statistics for Maps' })).getByText('Days with data').nextSibling).toHaveTextContent('2')
      // The same statistics chooser as the other panels, shared with the total panel.
      await user.click(within(merged).getByText(/Choose what to show/))
      await user.click(within(merged).getByRole('checkbox', { name: /Maximum/ }))
      await vi.waitFor(async () => expect(JSON.parse((await db.settings.get('dashboard.metrics'))?.value ?? '{}').screenTime).toContain('stat:max'))
      // Only 2 recorded days: the statistics need 5 values, as in the other panels.
      expect(within(merged).getByRole('group', { name: 'Statistics for Chat' })).toHaveTextContent('Insufficient data')
      await user.click(within(merged).getByText(/Show data/))
      const table = within(merged).getByRole('table', { name: 'Screen time by app values' })
      expect(within(table).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(['Period', 'Chat', 'Maps'])
      expect(within(table).getAllByRole('row').map((row) => row.textContent)).toEqual(expect.arrayContaining([
        expect.stringMatching(/^7 Nov 20261 h 00 min10 min$/), expect.stringMatching(/^8 Nov 20260 min30 min$/),
      ]))
      // Colour slots are kept: removing Chat leaves Maps in slot 2.
      expect(JSON.parse((await db.settings.get('dashboard.screenTimeApps'))?.value ?? 'null')).toEqual(['Chat', 'Maps'])
      await user.click(within(screen.getByRole('list', { name: 'Apps' })).getByRole('checkbox', { name: /Chat/ }))
      await vi.waitFor(async () => expect(JSON.parse((await db.settings.get('dashboard.screenTimeApps'))?.value ?? 'null')).toEqual([null, 'Maps']))

      unmount()
      render(<Dashboard />)
      const kept = await screen.findByRole('region', { name: 'Screen time by app' })
      expect(within(within(kept).getByRole('list', { name: 'Legend' })).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Maps'])
      await user.click(within(kept).getByRole('button', { name: 'Show total screen time' }))
      expect(await screen.findByRole('region', { name: 'Screen time' })).toBeInTheDocument()
    })

    it('shows the Dashboard when screen time is the only data', async () => {
      await db.externalSamples.add(screenTimeSample('f-9', '2026-11-09'))

      render(<Dashboard />)

      expect(await screen.findByRole('region', { name: 'Screen time' })).toBeInTheDocument()
      expect(screen.queryByText(/Nothing to show yet/)).not.toBeInTheDocument()
    })
  })

  describe('Health Connect activity and heart data', () => {
    it('shows steps (one source, the other named), heart rate and exercise panels', async () => {
      let n = 0
      const options = { zone: 'Europe/Paris', today: '2026-11-12', importedAt: '2026-11-12T08:00:00.000Z', newId: () => `hc-${++n}` }
      const step = (id: string, start: string, amount: number, origin: string) =>
        ({ id, origin, lastModifiedMs: null, startMs: Date.parse(start), endMs: Date.parse(start) + 60_000, offsetSeconds: 3600, amount })
      await db.externalSamples.bulkAdd([
        ...buildDailySamples('steps', [
          step('a', '2026-11-09T09:00:00Z', 6000, 'phone'),
          step('b', '2026-11-10T09:00:00Z', 8000, 'phone'),
          step('w', '2026-11-10T09:00:00Z', 7900, 'watch'),
        ], options).samples,
        ...buildDailySamples('heartRate', [
          { id: 'h', origin: 'watch', lastModifiedMs: null, offsetSeconds: 3600, samples: [[Date.parse('2026-11-10T09:00:00Z'), 60], [Date.parse('2026-11-10T10:00:00Z'), 80]] as [number, number][] },
        ], options).samples,
        ...buildExerciseSamples([
          { id: 'e', origin: 'watch', lastModifiedMs: null, startMs: Date.parse('2026-11-10T16:00:00Z'), endMs: Date.parse('2026-11-10T16:45:00Z'), startOffsetSeconds: 3600, exerciseType: 8, title: null },
        ], options).samples,
      ])

      render(<Dashboard />)
      const steps = await screen.findByRole('region', { name: 'Steps' })
      expect(within(steps).getByText(/Source: phone\. Also recorded by watch \(not added, to avoid counting twice\)\./)).toBeInTheDocument()
      await userEvent.click(within(steps).getByText(/Show data/))
      const rows = within(within(steps).getByRole('table')).getAllByRole('row').map((row) => row.textContent)
      expect(rows).toEqual(expect.arrayContaining([expect.stringMatching(/^9 Nov 2026.*6,?000/), expect.stringMatching(/^10 Nov 2026.*8,?000/)]))

      expect(screen.getByRole('region', { name: 'Heart rate' })).toBeInTheDocument()
      const exercise = screen.getByRole('region', { name: 'Exercise' })
      expect(within(exercise).getByText(/1 session in these dates: Cycling 45 min \(1 session\)/)).toBeInTheDocument()
      expect(screen.queryByRole('region', { name: 'Distance' })).not.toBeInTheDocument() // no data, no panel
    })
  })

  it('shows a Spending (YNAB) panel with 0 on days without spending', async () => {
    const options = { budgetId: 'b1', currency: 'EUR', zone: 'Europe/Paris', importedAt: '2026-11-10T08:00:00.000Z', newId: () => crypto.randomUUID() }
    const tx = (id: string, date: string, amount: number) => transactionSample({
      id, date, amount, memo: null, cleared: null, approved: true, flagColor: null, accountName: 'A', payeeName: null,
      categoryName: 'Groceries', transferAccountId: null, deleted: false, subtransactions: [],
    }, options)
    await db.externalSamples.bulkAdd([tx('a', '2026-11-08', -12500), tx('b', '2026-11-10', -2000)])
    render(<Dashboard />)
    const panel = await screen.findByRole('region', { name: 'Spending (YNAB)' })
    expect(within(panel).getByText(/Most spent in these dates: Groceries 14\.50 EUR/)).toBeInTheDocument()
    expect(within(within(panel).getByRole('list', { name: 'Legend' })).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Groceries'])
    expect(within(panel).getByText(/Show data by category/)).toBeInTheDocument()
    await userEvent.click(within(panel).getByText(/^Show data \(/))
    const rows = within(within(panel).getByRole('table', { name: 'Spending (YNAB) values' })).getAllByRole('row').map((row) => row.textContent)
    expect(rows).toEqual(expect.arrayContaining([expect.stringMatching(/^8 Nov 2026.*12\.5/), expect.stringMatching(/^9 Nov 20260/)]))
  })

  it('Spending: choose categories; only they are stacked and counted, with stable colours', async () => {
    const options = { budgetId: 'b1', currency: 'EUR', zone: 'Europe/Paris', importedAt: '2026-11-10T08:00:00.000Z', newId: () => crypto.randomUUID() }
    const tx = (id: string, date: string, amount: number, categoryName: string) => transactionSample({
      id, date, amount, memo: null, cleared: null, approved: true, flagColor: null, accountName: 'A', payeeName: null,
      categoryName, transferAccountId: null, deleted: false, subtransactions: [],
    }, options)
    await db.externalSamples.bulkAdd([tx('a', '2026-11-08', -50000, 'Rent'), tx('b', '2026-11-08', -12500, 'Groceries'), tx('c', '2026-11-09', -3000, 'Fun')])
    const user = userEvent.setup()
    render(<Dashboard />)
    const panel = await screen.findByRole('region', { name: 'Spending (YNAB)' })
    expect(within(panel).getByText('all categories')).toBeInTheDocument()

    await user.click(within(panel).getByRole('button', { name: 'Choose categories…' }))
    const list = within(panel).getByRole('list', { name: 'Categories' })
    expect(within(list).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Rent50.00 EUR', 'Groceries12.50 EUR', 'Fun3.00 EUR'])
    await user.click(within(list).getByRole('checkbox', { name: /Groceries/ }))
    await user.click(within(screen.getByRole('list', { name: 'Categories' })).getByRole('checkbox', { name: /Fun/ }))

    await vi.waitFor(() => expect(within(within(panel).getByRole('list', { name: 'Legend' })).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Groceries', 'Fun']))
    expect(JSON.parse((await db.settings.get('dashboard.ynabCategories'))?.value ?? 'null')).toEqual(['Groceries', 'Fun'])
    // The statistics and the totals table now count only the chosen categories.
    await user.click(within(panel).getByText(/^Show data \(/))
    const rows = within(within(panel).getByRole('table', { name: 'Spending (YNAB) values' })).getAllByRole('row').map((row) => row.textContent)
    expect(rows).toEqual(expect.arrayContaining([expect.stringMatching(/^8 Nov 2026.*12\.5/), expect.stringMatching(/^9 Nov 2026.*3/)]))

    await user.click(within(panel).getByRole('button', { name: 'Show all categories' }))
    await vi.waitFor(() => expect(within(panel).getByText('all categories')).toBeInTheDocument())
  })

  describe('location', () => {
    /** Mon 9 Nov 2026 (+01:00), fully recorded: home, 6 km cycling, office, home. */
    async function importDay() {
      const office = { visit: { hierarchyLevel: 0, topCandidate: { placeId: 'OFFICE', semanticType: 'INFERRED_WORK', placeLocation: { latLng: '45.1°, 5.1°' } } } }
      let next = 0
      const plan = planLocationImport({
        fileName: 'Timeline.json',
        text: timelineJson([
          visit('2026-11-09T00:00:00.000+01:00', '2026-11-09T08:00:00.000+01:00'),
          movement('2026-11-09T08:00:00.000+01:00', '2026-11-09T08:30:00.000+01:00', {
            activity: { start: { latLng: '45°, 5°' }, end: { latLng: '45.1°, 5.1°' }, distanceMeters: 6000, topCandidate: { type: 'CYCLING' } },
          }),
          visit('2026-11-09T08:30:00.000+01:00', '2026-11-09T17:00:00.000+01:00', office),
          visit('2026-11-09T17:00:00.000+01:00', '2026-11-10T00:00:00.000+01:00'),
        ]),
      }, [], { importedAt: '2026-11-10T08:00:00.000Z', newId: () => `loc-${next++}` })
      await db.externalSamples.bulkAdd(plan.toAdd)
    }

    it('shows one Location section, last, with distance by transport type, and switches views', async () => {
      await logWeek()
      await importDay()

      render(<Dashboard />)

      const locationSection = await screen.findByRole('region', { name: 'Location' })
      const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
      expect(headings.at(-1)).toBe('Location')
      expect(within(locationSection).getByText(/^Distance travelled:/)).toBeInTheDocument()
      expect(within(locationSection).getByText('Cycling 100 %')).toBeInTheDocument()
      expect(within(locationSection).getByText('Cycling 6.0 km')).toBeInTheDocument()
      expect(within(locationSection).getByText(/^Based on 1 recorded day \(Timeline recorded at least 20 h\)/)).toBeInTheDocument()

      await userEvent.selectOptions(within(locationSection).getByLabelText('Show'), 'Time away from…')
      expect(await within(locationSection).findByText(/^Time away from Home:/)).toBeInTheDocument()
      await userEvent.click(within(locationSection).getByText(/Show data/))
      // Away from home: 30 min cycling + 8 h 30 at the office = 9 h.
      expect(within(within(locationSection).getByRole('table')).getByText('9 h 00 min')).toBeInTheDocument()

      // Places, most time first: Home 15 h (8 h + 7 h), then the office 8 h 30.
      const from = within(locationSection).getByLabelText('From')
      expect(within(from).getAllByRole('option').map((o) => o.textContent)).toEqual([
        'Home · 1 day · 15 h',
        'Work (guessed) · 1 day · 8.5 h',
      ])
      await userEvent.selectOptions(from, 'Work (guessed) · 1 day · 8.5 h')
      expect(await within(locationSection).findByText(/^Time away from Work \(guessed\):/)).toBeInTheDocument()
      // Away from the office: 24 h − 8 h 30 = 15 h 30.
      expect(within(within(locationSection).getByRole('table')).getByText('15 h 30 min')).toBeInTheDocument()
      expect((await db.settings.get('dashboard.locationAwayPlace'))?.value).toBe('OFFICE')
      expect(within(locationSection).getByRole('link', { name: 'Show on map' })).toHaveAttribute(
        'href', 'https://www.openstreetmap.org/?mlat=45.1&mlon=5.1#map=17/45.1/5.1',
      )

      await userEvent.type(within(locationSection).getByLabelText('Name this place'), 'Office')
      await userEvent.click(within(locationSection).getByRole('button', { name: 'Save name' }))
      expect(await within(locationSection).findByText(/^Time away from Office:/)).toBeInTheDocument()
      expect(within(from).getByRole('option', { name: 'Office · 1 day · 8.5 h' })).toBeInTheDocument()
      expect(JSON.parse((await db.settings.get('location.placeNames'))!.value)).toEqual({ OFFICE: 'Office' })

      // "Time in…" uses the same chosen place: 8 h 30 at the office.
      await userEvent.selectOptions(within(locationSection).getByLabelText('Show'), 'Time in…')
      expect(await within(locationSection).findByText(/^Time in Office:/)).toBeInTheDocument()
      expect(within(locationSection).getByLabelText('In')).toHaveValue('OFFICE')
      expect(within(within(locationSection).getByRole('table')).getByText('8 h 30 min')).toBeInTheDocument()

      await userEvent.selectOptions(within(locationSection).getByLabelText('Show'), 'Places visited')
      expect(await within(locationSection).findByText(/^Places visited:/)).toBeInTheDocument()
      expect((await db.settings.get('dashboard.locationMeasure'))?.value).toBe('places')
    })

    it('opens on the view chosen last time', async () => {
      await importDay()
      await db.settings.put({ key: 'dashboard.locationMeasure', value: 'active', updatedAt: '2026-11-10T00:00:00.000Z', deletedAt: null, syncStatus: 'pending', revision: 1, syncedRevision: null })

      render(<Dashboard />)

      const locationSection = await screen.findByRole('region', { name: 'Location' })
      expect(within(locationSection).getByText(/^Active travel:/)).toBeInTheDocument()
      expect(within(locationSection).getByText('6.0 km')).toBeInTheDocument()
    })
  })

  describe('formulas', () => {
    it('shows each formula as a section (with negative durations signed) and explains a missing measure', async () => {
      await logWeek()
      await db.externalSamples.bulkAdd([
        screenTimeSample('s-4', '2026-11-04', { value: 9 * 3600 }), // 9 h screen time
        screenTimeSample('s-5', '2026-11-05', { value: 2 * 3600 }),
      ])
      await db.settings.put({
        key: 'formulas',
        value: JSON.stringify([
          { id: 'f_sleepscr1', name: 'Sleep minus screens', unit: null, display: 'duration', expression: '{sleep:duration} - {screenTime}' },
          { id: 'f_broken01', name: 'Broken formula', unit: null, display: 'number', expression: '{habit:deleted} + 1' },
        ]),
        updatedAt: '2026-11-10T00:00:00.000Z', deletedAt: null, syncStatus: 'pending', revision: 1, syncedRevision: null,
      })

      render(<Dashboard />)

      const formula = await screen.findByRole('region', { name: 'Sleep minus screens' })
      await userEvent.click(within(formula).getByText(/Show data/))
      // Night of 4 Nov: 8 h sleep − 9 h screen = −1 h; night of 5 Nov: 8 h − 2 h = 6 h.
      expect(within(within(formula).getByRole('table')).getByText('−1 h 00 min')).toBeInTheDocument()
      expect(within(within(formula).getByRole('table')).getByText('6 h 00 min')).toBeInTheDocument()

      const broken = screen.getByRole('region', { name: 'Broken formula' })
      expect(within(broken).getByText(/uses a measure that no longer exists/)).toBeInTheDocument()
    })
  })
})
