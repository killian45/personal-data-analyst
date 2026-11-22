import { messages } from '../i18n'
import { Capacitor } from '@capacitor/core'

/**
 * Saves content as a file chosen by the user.
 *
 * - Browser: a normal download.
 * - Android app: the WebView ignores downloads, so the file is written to
 *   the app's private cache folder "exports/" (replacing earlier files, so
 *   personal data does not pile up) and Android's share sheet opens: the
 *   user saves or sends it (Files, Drive, email…). Only that folder can be
 *   handed to other apps (android/app/src/main/res/xml/file_paths.xml).
 *
 * Throws if the file could not be written or shared (e.g. sharing was
 * cancelled), so the screen can tell the user.
 */
export async function saveFile(content: BlobPart, type: string, fileName: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    await shareFileOnDevice(content, type, fileName)
    return
  }

  const url = URL.createObjectURL(new Blob([content], { type }))

  try {
    const link = document.createElement('a')
    link.href = url
    link.download = fileName
    document.body.appendChild(link)
    link.click()
    link.remove()
  } finally {
    // Give the browser time to start the download before releasing it.
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }
}

export const DEVICE_EXPORT_FOLDER = 'exports'

/** Base64 of the bytes (Filesystem writes binary data given as base64). */
export async function toBase64(content: BlobPart, type: string): Promise<string> {
  const bytes = new Uint8Array(await new Blob([content], { type }).arrayBuffer())
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

async function shareFileOnDevice(content: BlobPart, type: string, fileName: string): Promise<void> {
  // Loaded on demand: only the Android app needs these plugins.
  const [{ Directory, Filesystem }, { Share }] = await Promise.all([
    import('@capacitor/filesystem'),
    import('@capacitor/share'),
  ])

  // Remove files from earlier exports (they may contain personal data).
  try {
    await Filesystem.rmdir({ path: DEVICE_EXPORT_FOLDER, directory: Directory.Cache, recursive: true })
  } catch {
    // The folder did not exist yet.
  }

  const { uri } = await Filesystem.writeFile({
    path: `${DEVICE_EXPORT_FOLDER}/${fileName}`,
    data: await toBase64(content, type),
    directory: Directory.Cache,
    recursive: true,
  })

  try {
    await Share.share({ title: fileName, dialogTitle: messages().importText.share.dialog(fileName), files: [uri] })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      /cancel/i.test(message)
        ? messages().importText.share.cancelled
        : messages().importText.share.failed(message),
    )
  }
}

/** UTC timestamp safe for file names, e.g. 2026-11-09T15-30-00Z. */
export function fileTimestamp(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z').replaceAll(':', '-')
}
