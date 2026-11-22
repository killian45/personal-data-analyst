import { lazy, Suspense, useSyncExternalStore } from 'react'
import type { Dispatch, SetStateAction } from 'react'

import { Capacitor } from '@capacitor/core'

import { DataBackupPanel } from '../components/DataBackupPanel'
import { DeleteAllDataPanel } from '../components/DeleteAllDataPanel'
import { DeletedDataPanel } from '../components/DeletedDataPanel'
import { DeviceImportOffNote, DeviceImportSwitchesPanel } from '../components/DeviceImportSwitchesPanel'
import { DisplayTimezoneSettings } from '../components/DisplayTimezoneSettings'
import { ExportPanel } from '../components/ExportPanel'
import { FeaturesPanel } from '../components/FeaturesPanel'
import { InstallPanel } from '../components/InstallPanel'
import { HabitImportPanel } from '../components/HabitImportPanel'
import { HealthConnectImportPanel } from '../components/HealthConnectImportPanel'
import { LanguageSettings } from '../components/LanguageSettings'
import { PageHeading } from '../components/layout/PageHeading'
import { SettingsGroup } from '../components/layout/SettingsGroup'
import { RestoreBackupPanel } from '../components/RestoreBackupPanel'
import { ScreenTimeImportPanel } from '../components/ScreenTimeImportPanel'
import { SleepTargetsSettings } from '../components/SleepTargetsSettings'
import { TimelineImportPanel } from '../components/TimelineImportPanel'
import { DEFAULT_DEVICE_IMPORTS, getDeviceImports, subscribeDeviceImports } from '../settings/deviceImports'
import { getFeatures, subscribeFeatures } from '../settings/features'
import { messages } from '../i18n'
import { loadDisplayTimezone, saveDisplayTimezone } from '../settings/displayTimezone'
import type { DisplayTimezone } from '../settings/displayTimezone'
import { isSyncConfigured, type SyncBackend } from '../sync/backendTypes'
import type { SyncController } from '../sync/syncController'

// Android app only: Health Connect and screen-time import on the phone.
const DeviceHealthConnectImportPanel = lazy(() => import('../components/DeviceHealthConnectImportPanel'))
const DeviceScreenTimeImportPanel = lazy(() => import('../components/DeviceScreenTimeImportPanel'))
const PhoneContactImportPanel = lazy(() => import('../components/crm/PhoneContactImportPanel'))
const HealthDataImportPanel = lazy(() => import('../components/HealthDataImportPanel'))
const YnabPanel = lazy(() => import('../components/YnabPanel'))
// Loaded on demand: sync code is only downloaded when it is used.
const SyncPanel = lazy(() => import('../components/SyncPanel').then((module) => ({ default: module.SyncPanel })))

/**
 * The "Settings & Data" page: sync, display settings, imports, exports,
 * backups and the danger zone. The app (App.tsx) keeps the shared state
 * and passes it in.
 */

export interface SettingsDataPageProps {
  syncBackend: SyncBackend | null
  syncController: SyncController | null
  displayTimezone: DisplayTimezone
  setDisplayTimezone: (value: DisplayTimezone) => void
  /** Increased after imports and restores, so panels reload their data. */
  restoreCount: number
  setRestoreCount: Dispatch<SetStateAction<number>>
  /** Reloads everything after data changed elsewhere (sync, phone import). */
  reloadAfterExternalChange: () => void
  loadHabits: () => Promise<void>
  loadActiveTimers: () => Promise<void>
}

export function SettingsDataPage({
  syncBackend,
  syncController,
  displayTimezone,
  setDisplayTimezone,
  restoreCount,
  setRestoreCount,
  reloadAfterExternalChange,
  loadHabits,
  loadActiveTimers,
}: SettingsDataPageProps) {
  const t = messages().settings
  const isAndroid = Capacitor.getPlatform() === 'android'
  // Per-device import switches: Android app only; elsewhere everything is shown.
  const deviceImports = useSyncExternalStore(subscribeDeviceImports, getDeviceImports)
  const imports = isAndroid ? deviceImports : DEFAULT_DEVICE_IMPORTS
  // Optional features (S4): a feature that is off hides its panels entirely.
  const features = useSyncExternalStore(subscribeFeatures, getFeatures)

  return (
    <section>
      <PageHeading
        title={t.title}
        description={t.description}
      />

      <div className="space-y-6">
        <Suspense fallback={<p className="text-sm text-slate-500">{t.loadingSync}</p>}>
          <SyncPanel
            backend={syncBackend}
            loading={isSyncConfigured() && !syncBackend}
            controller={syncController}
            displayTimezone={displayTimezone}
            onDataChanged={reloadAfterExternalChange}
          />
        </Suspense>

        <SettingsGroup title={t.groups.display.title} description={t.groups.display.description}>
          <LanguageSettings />

          <DisplayTimezoneSettings
            value={displayTimezone}
            onSave={async (value) => {
              setDisplayTimezone(await saveDisplayTimezone(value))
            }}
          />

          <SleepTargetsSettings key={`targets-${restoreCount}`} />
        </SettingsGroup>

        <SettingsGroup title={messages().features.groupTitle} description={messages().features.groupDescription}>
          <FeaturesPanel />
        </SettingsGroup>

        {/* The web version only: the Android app is already installed. */}
        {!Capacitor.isNativePlatform() && (
          <SettingsGroup title={messages().install.groupTitle} description={messages().install.groupDescription}>
            <InstallPanel />
          </SettingsGroup>
        )}

        <SettingsGroup
          title={t.groups.import.title}
          description={t.groups.import.description}
        >
          {isAndroid && (
            <>
              <DeviceImportSwitchesPanel
                onScreenTimeOff={async () => {
                  const { stopUsageCapture } = await import('../screenTime/usageStatsPlugin')
                  await stopUsageCapture()
                }}
              />
              <Suspense fallback={null}>
                {imports.healthConnect ? (
                  <>
                    <DeviceHealthConnectImportPanel
                      controller={syncController}
                      syncConfigured={isSyncConfigured()}
                      onImported={reloadAfterExternalChange}
                    />
                    <HealthDataImportPanel
                      controller={syncController}
                      syncConfigured={isSyncConfigured()}
                      onImported={reloadAfterExternalChange}
                    />
                  </>
                ) : (
                  <DeviceImportOffNote kind="healthConnect" />
                )}
                {features.screenTime && (imports.screenTime ? (
                  <DeviceScreenTimeImportPanel
                    controller={syncController}
                    syncConfigured={isSyncConfigured()}
                    onImported={reloadAfterExternalChange}
                  />
                ) : (
                  <DeviceImportOffNote kind="screenTime" />
                ))}
                {features.crm && (imports.contacts ? (
                  <PhoneContactImportPanel controller={syncController} syncConfigured={isSyncConfigured()} />
                ) : (
                  <DeviceImportOffNote kind="contacts" />
                ))}
              </Suspense>
            </>
          )}

          <HabitImportPanel version={restoreCount} onImported={reloadAfterExternalChange} />

          {imports.healthConnect && (
            <HealthConnectImportPanel
              onImported={() => setRestoreCount((count) => count + 1)}
            />
          )}

          {features.screenTime && imports.screenTime && (
            <ScreenTimeImportPanel
              onImported={() => setRestoreCount((count) => count + 1)}
            />
          )}

          {features.location && (imports.location ? (
            <TimelineImportPanel
              onImported={() => setRestoreCount((count) => count + 1)}
            />
          ) : (
            <DeviceImportOffNote kind="location" />
          ))}

          {features.ynab && (
            <Suspense fallback={null}>
              <YnabPanel controller={syncController} syncConfigured={isSyncConfigured()} onImported={reloadAfterExternalChange} />
            </Suspense>
          )}
        </SettingsGroup>

        <SettingsGroup title={t.groups.export.title} description={t.groups.export.description}>
          <ExportPanel key={`export-${restoreCount}`} />

          <DataBackupPanel />

          <RestoreBackupPanel
            onRestored={() => {
              setRestoreCount((count) => count + 1)
              void loadHabits()
              void loadActiveTimers()
              void loadDisplayTimezone().then(setDisplayTimezone)
            }}
          />
        </SettingsGroup>

        <SettingsGroup title={t.groups.deleted.title} description={t.groups.deleted.description}>
          <DeletedDataPanel
            key={restoreCount}
            displayTimezone={displayTimezone}
            onHabitRestored={() => void loadHabits()}
          />
        </SettingsGroup>

        <SettingsGroup title={t.groups.danger.title} description={t.groups.danger.description} danger>
          <DeleteAllDataPanel
            syncNow={syncController ? () => syncController.syncNow() : null}
            afterDeletion={async () => {
              // This device's YNAB token and automatic import go too.
              const { setYnabConnection } = await import('../ynab/ynabConnection')
              setYnabConnection(null)
              const { ynabImporter } = await import('../ynab/ynabImport')
              ynabImporter.resetAfterDeletion()
              // The Goals chat is kept on this device only.
              const { clearChat } = await import('../goals/chatStore')
              clearChat()
              const { clearOpinions } = await import('../goals/opinion')
              clearOpinions()
              if (Capacitor.getPlatform() === 'android') {
                // Otherwise the restarted app would import screen time again
                // straight away; the user can turn it back on.
                const { resetAutoImportAfterDeletion } = await import('../screenTime/autoImport')
                resetAutoImportAfterDeletion()
                const { healthImporter } = await import('../healthData/healthImport')
                healthImporter.resetAfterDeletion()
                const { clearCapturedHistory } = await import('../screenTime/usageStatsPlugin')
                await clearCapturedHistory()
              }
              if (syncBackend) {
                // Signs out this device only. The session is removed locally
                // before any network request, so an offline error here only
                // means the server could not be told; it is not a failure.
                await syncBackend.auth.signOut().catch(() => undefined)
              }
            }}
            restart={() => window.location.reload()}
          />
        </SettingsGroup>
      </div>
    </section>
  )
}
