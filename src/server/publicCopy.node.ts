/**
 * Makes the clean public copy of the project (sharing plan S0/S6, finding
 * A8): the files Git tracks, WITHOUT the owner's notes, personal plans and
 * Git history, then scans the copy for personal information. Nothing is
 * published by this script.
 *
 *   node src/server/publicCopy.node.ts <empty target folder>
 *
 * Exit code 1 (and a list) when something personal is found; the copy is
 * then not ready to publish.
 */
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** Never in the public copy: notes, working instructions, personal plans. */
export const EXCLUDED = [
  'PROJECT_NOTES.md',
  'CLAUDE.md',
  'docs/ANDROID_PLAN.md',
  'docs/GOALS_PLAN.md',
  // Mentions the owner's own health data (a medication) and server.
  'docs/HABIT_IMPORT.md',
  'docs/SYNC_DESIGN.md',
  'docs/HEALTH_DATA_PLAN.md',
  'docs/PHASE5_PLAN.md',
  'docs/PHASE6_PLAN.md',
  'docs/SHARING_PLAN.md',
  'docs/YNAB_PLAN.md',
]

/** Generic personal information that must not appear in the public copy. */
export const PERSONAL_PATTERNS: readonly { name: string; pattern: RegExp }[] = [
  { name: 'personal e-mail address', pattern: /[a-z0-9._%+-]+@(gmail|hotmail|outlook|yahoo|icloud|proton(mail)?)\.[a-z]+/i },
  { name: 'Supabase project address', pattern: /\b[a-z0-9]{20}\.supabase\.(co|in)\b/ },
  { name: 'home folder path', pattern: /\/home\/[a-z]/i },
]

/**
 * The owner's own words to look for (names, server name, devices): one per
 * line in this file, which Git ignores, so they are never copied or
 * published. Lines starting with # are comments.
 */
export const OWNER_WORDS_FILE = 'public-copy-words.local'

export function ownerWords(path = OWNER_WORDS_FILE): string[] {
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8').split('\n').map((line) => line.trim()).filter((line) => line !== '' && !line.startsWith('#'))
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** The generic patterns plus one pattern per owner word (case ignored). */
export function personalPatterns(words: readonly string[] = ownerWords()): { name: string; pattern: RegExp }[] {
  return [...PERSONAL_PATTERNS, ...words.map((word) => ({ name: `owner word "${word.slice(0, 2)}…"`, pattern: new RegExp(escapeRegExp(word), 'i') }))]
}

export function publicFiles(projectDir: string): string[] {
  const tracked = execFileSync('git', ['ls-files'], { cwd: projectDir, encoding: 'utf8' }).split('\n').filter(Boolean)
  return tracked.filter((file) => !EXCLUDED.includes(file) && existsSync(join(projectDir, file)))
}

/** "file:line: what" for every personal match in the copied text files. */
export function scanForPersonalInformation(dir: string, files: readonly string[], patterns = personalPatterns()): string[] {
  const found: string[] = []
  for (const file of files) {
    const buffer = readFileSync(join(dir, file))
    if (buffer.includes(0)) continue // binary (images, keystores…)
    buffer.toString('utf8').split('\n').forEach((line, index) => {
      for (const { name, pattern } of patterns) {
        if (pattern.test(line)) found.push(`${file}:${index + 1}: ${name}`)
      }
    })
  }
  return found
}

if (process.argv[1]?.endsWith('publicCopy.node.ts')) {
  const target = process.argv[2]
  if (!target) {
    console.error('Usage: node src/server/publicCopy.node.ts <empty target folder>')
    process.exit(2)
  }
  if (existsSync(target) && readdirSync(target).length > 0) {
    console.error(`${target} is not empty; choose an empty or new folder.`)
    process.exit(2)
  }
  const words = ownerWords()
  if (words.length === 0) {
    console.error(`${OWNER_WORDS_FILE} is missing or empty: add the owner's names, server and devices (one per line) before making a copy.`)
    process.exit(2)
  }
  const files = publicFiles('.')
  for (const file of files) {
    mkdirSync(dirname(join(target, file)), { recursive: true })
    copyFileSync(file, join(target, file))
  }
  const found = scanForPersonalInformation(target, files)
  console.log(`Copied ${files.length} files to ${target} (left out: ${EXCLUDED.join(', ')}).`)
  for (const line of found) console.error(`PERSONAL: ${line}`)
  if (found.length > 0) {
    console.error(`${found.length} personal item(s) found: the copy is NOT ready to publish.`)
    process.exit(1)
  }
  console.log('No personal information found.')
}
