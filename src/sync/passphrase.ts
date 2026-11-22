/**
 * Sync passphrase rules (docs/SYNC_DESIGN.md §3).
 *
 * The passphrase is normalised to Unicode NFC so that the same visible text
 * typed on different devices or keyboards always gives the same key.
 * Length is counted in Unicode code points (an emoji counts as one).
 * Nothing else is changed: spaces are kept, case matters.
 */

export const MIN_PASSPHRASE_LENGTH = 12

export type PassphraseCheck =
  | { status: 'ok'; normalized: string }
  | { status: 'too-short'; length: number; minimum: number }

export function normalizePassphrase(passphrase: string): string {
  return passphrase.normalize('NFC')
}

export function checkPassphrase(passphrase: string): PassphraseCheck {
  const normalized = normalizePassphrase(passphrase)
  const length = [...normalized].length
  if (length < MIN_PASSPHRASE_LENGTH) {
    return { status: 'too-short', length, minimum: MIN_PASSPHRASE_LENGTH }
  }
  return { status: 'ok', normalized }
}
