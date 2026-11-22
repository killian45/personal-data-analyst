import { saveFile } from '../files/saveFile'

import { backupFileName, createBackup, serializeBackup } from './backup'
import type { BackupFile } from './backup'

/**
 * Creates a backup of the whole local database and asks the browser
 * to download it as a JSON file.
 *
 * Returns the backup so the interface can report what was exported.
 */
export async function downloadBackup(): Promise<BackupFile> {
  const exportedAt = new Date()
  const backup = await createBackup(exportedAt)

  await saveFile(serializeBackup(backup), 'application/json', backupFileName(exportedAt))

  return backup
}
