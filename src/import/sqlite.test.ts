import { describe, expect, it } from 'vitest'

import { isSqliteFile, loadSqlJs, openSqlite } from './sqlite'

describe('sqlite', () => {
  it('opens a database created with sql.js and reads it back', async () => {
    const SQL = await loadSqlJs()
    const source = new SQL.Database()
    source.run('create table t (a integer, b text)')
    source.run("insert into t values (1, 'x'), (2, 'y')")
    const bytes = source.export()
    source.close()

    expect(isSqliteFile(bytes)).toBe(true)

    const db = await openSqlite(bytes)
    expect(db.exec('select count(*) from t')[0].values[0][0]).toBe(2)
    db.close()
  })

  it('refuses files that are not SQLite databases', async () => {
    await expect(openSqlite(new TextEncoder().encode('not a database at all'))).rejects.toThrow(
      'The file is not a SQLite database.',
    )
  })
})
