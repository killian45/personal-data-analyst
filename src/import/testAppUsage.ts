/**
 * Builds made-up App Usage "Usage history" CSV files for tests, in the
 * layout of the real exports (no real data).
 */
export interface TestAppUsageOptions {
  /** Numeric date line, e.g. "11/9/26" (month/day/year). */
  dateLine?: string
  title?: string | null
  created?: string | null
  apps?: [string, string, string][]
  total?: string
  extraDateLines?: string[]
}

export function appUsageCsv(options: TestAppUsageOptions = {}): string {
  const apps = options.apps ?? [
    ['Messages', '1:02:03', '12'],
    ['Maps, offline', '0:10:00', '3'],
    ['Browser', '0:00:57', '1'],
  ]
  const lines = [
    'App name,Usage time,Access count',
    ...apps.map(([name, time, count]) => `${name.includes(',') ? `"${name}"` : name},${time},${count}`),
    '',
    'Date,Usage time',
    `${options.dateLine ?? '11/9/26'},${options.total ?? '1:13:00'}`,
    ...(options.extraDateLines ?? []),
    '',
  ]
  const title = options.title === undefined ? 'Usage history, November 9, 2026' : options.title
  const created = options.created === undefined ? 'Created by App Usage (PRO) on Tuesday, November 10, 2026 at 02:01' : options.created
  if (title !== null) lines.push(`"${title}"`)
  if (created !== null) lines.push(`"${created}"`)
  return `${lines.join('\n')}\n`
}
