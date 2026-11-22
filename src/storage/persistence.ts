/**
 * Persistent storage helpers.
 *
 * By default, browsers may delete IndexedDB data when the device is low
 * on disk space ("best-effort" storage). Asking for persistent storage
 * tells the browser not to delete it automatically.
 *
 * Browsers decide differently:
 * - Firefox asks the user.
 * - Chrome/Edge decide automatically (for example, more likely for an
 *   installed app) and may refuse without asking.
 *
 * Persistent storage does NOT protect against the user clearing site
 * data, uninstalling the browser or losing the device. Backups are still
 * required.
 */

export type PersistenceStatus =
  | 'persistent'
  | 'not-persistent'
  | 'unsupported'

type StorageApi = Pick<StorageManager, 'persisted' | 'persist' | 'estimate'>

function defaultStorage(): StorageApi | undefined {
  return globalThis.navigator?.storage
}

function isSupported(
  storage: StorageApi | undefined,
): storage is StorageApi {
  return (
    storage !== undefined &&
    typeof storage.persisted === 'function' &&
    typeof storage.persist === 'function'
  )
}

/**
 * Checks the current status without asking the user anything.
 */
export async function getPersistenceStatus(
  storage: StorageApi | undefined = defaultStorage(),
): Promise<PersistenceStatus> {
  if (!isSupported(storage)) {
    return 'unsupported'
  }

  try {
    return (await storage.persisted())
      ? 'persistent'
      : 'not-persistent'
  } catch {
    return 'unsupported'
  }
}

/**
 * Asks the browser for persistent storage.
 * Firefox may show a permission prompt.
 */
export async function requestPersistentStorage(
  storage: StorageApi | undefined = defaultStorage(),
): Promise<PersistenceStatus> {
  if (!isSupported(storage)) {
    return 'unsupported'
  }

  try {
    if (await storage.persisted()) {
      return 'persistent'
    }

    return (await storage.persist())
      ? 'persistent'
      : 'not-persistent'
  } catch {
    return 'not-persistent'
  }
}

export interface StorageEstimateResult {
  usageBytes: number
  quotaBytes: number
}

/**
 * Returns approximate storage usage, or null when unavailable.
 */
export async function getStorageEstimate(
  storage: StorageApi | undefined = defaultStorage(),
): Promise<StorageEstimateResult | null> {
  if (!storage || typeof storage.estimate !== 'function') {
    return null
  }

  try {
    const estimate = await storage.estimate()

    if (
      typeof estimate.usage !== 'number' ||
      typeof estimate.quota !== 'number'
    ) {
      return null
    }

    return {
      usageBytes: estimate.usage,
      quotaBytes: estimate.quota,
    }
  } catch {
    return null
  }
}
