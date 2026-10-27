import { mkdirSync, statSync } from 'node:fs'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'
import { SCHEMA_SQL, SCHEMA_VERSION } from './schema'

export type Db = Database.Database

export function openDatabase(dbPath: string): Db {
  mkdirSync(dirname(dbPath), { recursive: true })
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')
  migrate(db)
  return db
}

function migrate(db: Db): void {
  const current = db.pragma('user_version', { simple: true }) as number
  if (current === SCHEMA_VERSION) return
  if (current > SCHEMA_VERSION) {
    throw new Error(
      `Database was created by a newer version of the app (schema ${current}, this build supports ${SCHEMA_VERSION}).`
    )
  }
  db.exec('BEGIN')
  try {
    db.exec(SCHEMA_SQL)
    db.pragma(`user_version = ${SCHEMA_VERSION}`)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export function databaseInfo(db: Db, dbPath: string): { sqliteVersion: string; fts5: boolean; sizeBytes: number } {
  const sqliteVersion = (db.pragma('compile_version', { simple: true }) as string | undefined)
    ?? (db.prepare('SELECT sqlite_version() AS v').get() as { v: string }).v
  let fts5 = false
  try {
    db.exec('CREATE VIRTUAL TABLE __fts5_probe USING fts5(x)')
    db.exec('DROP TABLE __fts5_probe')
    fts5 = true
  } catch {
    fts5 = false
  }
  let sizeBytes = 0
  try {
    sizeBytes = statSync(dbPath).size
  } catch {
    sizeBytes = 0
  }
  return { sqliteVersion, fts5, sizeBytes }
}
