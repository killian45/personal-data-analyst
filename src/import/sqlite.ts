import { messages } from '../i18n'
import initSqlJs from 'sql.js'
import type { Database, SqlJsStatic } from 'sql.js'
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url'

/**
 * Opens SQLite database files with sql.js (SQLite compiled to
 * WebAssembly), entirely on this device. sql.js and its WebAssembly file
 * are only loaded when an import needs them.
 *
 * In the browser the WebAssembly file is served by the app (Vite asset);
 * under Node (tests) sql.js loads it from its own package folder.
 */

let loading: Promise<SqlJsStatic> | null = null

function runningInNode(): boolean {
  const process = (globalThis as { process?: { versions?: { node?: string } } }).process
  return typeof process?.versions?.node === 'string'
}

export function loadSqlJs(): Promise<SqlJsStatic> {
  loading ??= initSqlJs(runningInNode() ? {} : { locateFile: () => wasmUrl })
  return loading
}

/** "SQLite format 3\0", the first 16 bytes of every SQLite database file. */
export function isSqliteFile(bytes: Uint8Array): boolean {
  const header = 'SQLite format 3\u0000'
  return bytes.length >= 16 && [...header].every((char, index) => bytes[index] === char.charCodeAt(0))
}

export async function openSqlite(bytes: Uint8Array): Promise<Database> {
  if (!isSqliteFile(bytes)) {
    throw new Error(messages().importText.notSqlite)
  }

  const SQL = await loadSqlJs()
  return new SQL.Database(bytes)
}
