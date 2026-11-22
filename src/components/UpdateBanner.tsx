import { useRegisterSW } from 'virtual:pwa-register/react'

import { messages } from '../i18n'

/**
 * Registers the service worker (production builds only) and tells the
 * user when the app is ready offline or when a new version is waiting.
 *
 * A new version is only activated when the user clicks "Reload", so
 * nothing they are typing is lost by an automatic reload.
 */
export function UpdateBanner() {
  const t = messages().updateBanner
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError(error: unknown) {
      console.error('Service worker registration failed:', error)
    },
  })

  if (needRefresh) {
    return (
      <div
        role="status"
        className="border-b border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900"
      >
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
          <span>
            {t.newVersion}
          </span>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void updateServiceWorker(true)}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
            >
              {t.reload}
            </button>

            <button
              type="button"
              onClick={() => setNeedRefresh(false)}
              className="rounded-md border border-blue-300 px-3 py-1.5 text-xs font-medium hover:bg-white"
            >
              {t.later}
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (offlineReady) {
    return (
      <div
        role="status"
        className="border-b border-green-200 bg-green-50 px-4 py-3 text-sm text-green-900"
      >
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
          <span>{t.offlineReady}</span>

          <button
            type="button"
            onClick={() => setOfflineReady(false)}
            className="rounded-md border border-green-300 px-3 py-1.5 text-xs font-medium hover:bg-white"
          >
            {t.ok}
          </button>
        </div>
      </div>
    )
  }

  return null
}
