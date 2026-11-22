/**
 * Builds supabase/setup.sql (sharing plan S5): every migration in
 * supabase/migrations, in order, in one file that a person pastes once
 * into the Supabase SQL editor of a NEW project.
 *
 * Run after adding a migration:  npm run setup-sql
 * src/server/setupSql.node.test.ts fails if the file is out of date.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const MIGRATIONS_DIR = 'supabase/migrations'
export const SETUP_SQL_PATH = 'supabase/setup.sql'

const HEADER = `-- Personal Data Analyst — sync server setup (one file).
--
-- Paste this whole file into the SQL editor of a NEW, empty Supabase
-- project and press Run, once. It creates the tables and security rules
-- the app needs for sync; everything the app stores here is encrypted on
-- your devices first.
--
-- Generated from supabase/migrations by "npm run setup-sql". Do not edit
-- by hand: change the migrations instead.
`

/** The file content, from the migrations in name order (their names start with a timestamp). */
export function buildSetupSql(migrationsDir = MIGRATIONS_DIR): string {
  const files = readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort()
  const parts = files.map((name) => `\n-- ===== ${name} =====\n\n${readFileSync(join(migrationsDir, name), 'utf8').trimEnd()}\n`)
  return `${HEADER}${parts.join('')}`
}

if (process.argv[1]?.endsWith('setupSql.node.ts')) {
  writeFileSync(SETUP_SQL_PATH, buildSetupSql())
  console.log(`Wrote ${SETUP_SQL_PATH}`)
}
