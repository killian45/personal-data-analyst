// @vitest-environment node
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { buildSetupSql, SETUP_SQL_PATH } from './setupSql.node.ts'

describe('supabase/setup.sql (sharing plan S5)', () => {
  it('is up to date with supabase/migrations (run "npm run setup-sql" after adding one)', () => {
    expect(readFileSync(SETUP_SQL_PATH, 'utf8')).toBe(buildSetupSql())
  })

  it('contains every migration, in order, and the tables the app tests for', () => {
    const sql = buildSetupSql()
    const order = ['sync_schema', 'delete_my_cloud_data', 'restrict_rls_auto_enable', 'crm_collections'].map((name) => sql.indexOf(name))
    expect(order.every((position) => position > 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(sql).toContain('create table public.user_keys')
  })
})
