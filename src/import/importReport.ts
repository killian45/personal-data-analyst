import { messages } from '../i18n'
import type { SleepImportPlan } from './sleepImport'

// Kept separate from sleepImport.ts (which loads the zip reader and SQLite
// engine on demand) so screens can use it without loading those.

/** Message shown after a successful import (shared by both importers). */
export function importResultText(plan: SleepImportPlan, imported: number): string {
  return (
    messages().importText.sleepImported(imported) +
    (plan.duplicates.length > 0 ? messages().importText.skippedDuplicates(plan.duplicates.length) : '') +
    (plan.needsAttention.length > 0 ? messages().importText.needAttentionAgain(plan.needsAttention.length) : '') +
    (plan.invalid.length > 0 ? messages().importText.invalidNotImported(plan.invalid.length) : '')
  )
}

