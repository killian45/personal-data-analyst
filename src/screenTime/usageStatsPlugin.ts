/**
 * Thin wrapper around this app's own Android plugin "UsageStats"
 * (android/app/src/main/java/com/personaldataanalyst/app/UsageStatsPlugin.java).
 * Android app only; read only. Needs "Usage access", which the user
 * switches on in the phone's Settings.
 */

import { Capacitor, registerPlugin } from '@capacitor/core'

import type { CoveredRange, UsageEventsData } from './usageEvents'

/** State of the hourly background capture (UsageCapture.java). */
export interface CaptureStatus {
  /** true / false, or null when never chosen (then it starts automatically). */
  enabled: boolean | null
  lastRunMs: number | null
  /** Start of the oldest saved span, or null if nothing is saved. */
  coveredFromMs: number | null
  /** PDA may run in the background without battery restrictions. */
  batteryUnrestricted: boolean
}

export interface CapturedHistory extends UsageEventsData {
  labels: Record<string, string>
  ranges: [number, number][]
}

type RawStatus = { enabled?: boolean; lastRunMs?: number; coveredFromMs?: number; batteryUnrestricted: boolean }

interface UsageStatsPluginApi {
  checkAccess(): Promise<{ granted: boolean }>
  openAccessSettings(): Promise<void>
  readEvents(options: { startMs: number; endMs: number }): Promise<UsageEventsData>
  historyDepth(): Promise<{ nowMs: number; earliestEventMs?: number | null }>
  appLabels(options: { packages: string[] }): Promise<{ labels: Record<string, string> }>
  homePackages(): Promise<{ packages: string[] }>
  startCapture(): Promise<void>
  stopCapture(): Promise<void>
  captureStatus(): Promise<RawStatus>
  captureNow(): Promise<RawStatus & { saved: number }>
  readCaptured(options: { startMs: number }): Promise<CapturedHistory>
  clearCapture(): Promise<void>
  openAppSettings(): Promise<void>
}

const UsageStats = registerPlugin<UsageStatsPluginApi>('UsageStats')

/** True only inside the Android app. */
export function isUsageStatsPlatform(): boolean {
  return Capacitor.getPlatform() === 'android'
}

export async function hasUsageAccess(): Promise<boolean> {
  return (await UsageStats.checkAccess()).granted
}

export async function openUsageAccessSettings(): Promise<void> {
  await UsageStats.openAccessSettings()
}

export async function readUsageEvents(startMs: number, endMs: number): Promise<UsageEventsData> {
  return UsageStats.readEvents({ startMs, endMs })
}

/** The phone's current time and the oldest usage event Android still keeps. */
export async function readHistoryDepth(): Promise<{ nowMs: number; earliestEventMs: number | null }> {
  const depth = await UsageStats.historyDepth()
  // Android leaves the value out when it has no events at all.
  return { nowMs: depth.nowMs, earliestEventMs: depth.earliestEventMs ?? null }
}

/** App display names by package (apps without a launcher icon are absent). */
export async function readAppLabels(packages: string[]): Promise<Record<string, string>> {
  return (await UsageStats.appLabels({ packages })).labels
}

export async function readHomePackages(): Promise<string[]> {
  return (await UsageStats.homePackages()).packages
}

function toStatus(raw: RawStatus): CaptureStatus {
  // Android leaves out values it does not have.
  return {
    enabled: raw.enabled ?? null,
    lastRunMs: raw.lastRunMs ?? null,
    coveredFromMs: raw.coveredFromMs ?? null,
    batteryUnrestricted: raw.batteryUnrestricted,
  }
}

export async function startUsageCapture(): Promise<void> {
  await UsageStats.startCapture()
}

export async function stopUsageCapture(): Promise<void> {
  await UsageStats.stopCapture()
}

export async function readCaptureStatus(): Promise<CaptureStatus> {
  return toStatus(await UsageStats.captureStatus())
}

/** Saves the latest usage events now. */
export async function captureUsageNow(): Promise<CaptureStatus> {
  return toStatus(await UsageStats.captureNow())
}

/** The saved usage history from startMs on (events, app names, covered spans). */
export async function readCapturedHistory(startMs: number): Promise<{ events: UsageEventsData; labels: Record<string, string>; covered: CoveredRange[] }> {
  const raw = await UsageStats.readCaptured({ startMs })
  return {
    events: { packages: raw.packages, classes: raw.classes, events: raw.events },
    labels: raw.labels,
    covered: raw.ranges.map(([startMs, endMs]) => ({ startMs, endMs })),
  }
}

export async function openAppSettings(): Promise<void> {
  await UsageStats.openAppSettings()
}

/**
 * Starts the hourly capture when Usage access is on, unless the user
 * turned it off. Safe to call often (the schedule is kept, not repeated).
 */
export async function ensureUsageCapture(): Promise<void> {
  if (!isUsageStatsPlatform() || !(await hasUsageAccess())) return
  const status = await readCaptureStatus()
  if (status.enabled !== false) await startUsageCapture()
}

/** Deletes the screen-time history saved by the background capture (Android only). */
export async function clearCapturedHistory(): Promise<void> {
  await UsageStats.clearCapture()
}
