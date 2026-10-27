import type {
  FileStatus,
  FolderSummary,
  IndexStats,
  LogEntry,
  LogLevel,
  SkipReasonCode
} from '@shared/types'
import type { Db } from '../db/database'
import { normalize } from '../search/normalize'
import { extensionOf, parentOf, pathKey } from '../utils/paths'
import type { Chunk } from '../indexer/chunker'
import type { WalkEntry } from '../indexer/walk'

export interface FolderRow {
  id: number
  path: string
  pathKey: string
  addedAt: number
  lastIndexedAt: number | null
  ocrEnabled: boolean
}

export interface FileRow {
  id: number
  folderId: number
  path: string
  pathKey: string
  name: string
  ext: string
  size: number
  mtime: number
  status: FileStatus
  skipReason: string | null
}

export function addFolder(db: Db, absolutePath: string): { folder: FolderRow } | { duplicateOf: number } {
  const key = pathKey(absolutePath)
  const existing = db.prepare('SELECT id FROM folders WHERE path_key = ?').get(key) as
    | { id: number }
    | undefined
  if (existing) return { duplicateOf: existing.id }

  const info = db
    .prepare('INSERT INTO folders (path, path_key, added_at) VALUES (?, ?, ?)')
    .run(absolutePath, key, Date.now())
  return { folder: getFolder(db, Number(info.lastInsertRowid)) as FolderRow }
}

export function getFolder(db: Db, id: number): FolderRow | undefined {
  const row = db
    .prepare('SELECT id, path, path_key, added_at, last_indexed_at, ocr_enabled FROM folders WHERE id = ?')
    .get(id) as
    | {
        id: number
        path: string
        path_key: string
        added_at: number
        last_indexed_at: number | null
        ocr_enabled: number
      }
    | undefined
  if (!row) return undefined
  return {
    id: row.id,
    path: row.path,
    pathKey: row.path_key,
    addedAt: row.added_at,
    lastIndexedAt: row.last_indexed_at,
    ocrEnabled: row.ocr_enabled === 1
  }
}

export function listFolders(db: Db): FolderSummary[] {
  const rows = db
    .prepare(
      `SELECT f.id, f.path, f.added_at, f.last_indexed_at,
              COUNT(fi.id) AS file_count,
              SUM(CASE WHEN fi.status = 'indexed' THEN 1 ELSE 0 END) AS indexed_count,
              SUM(CASE WHEN fi.status IN ('skipped','error') THEN 1 ELSE 0 END) AS skipped_count
         FROM folders f
         LEFT JOIN files fi ON fi.folder_id = f.id
        GROUP BY f.id
        ORDER BY f.added_at`
    )
    .all() as {
    id: number
    path: string
    added_at: number
    last_indexed_at: number | null
    file_count: number
    indexed_count: number | null
    skipped_count: number | null
  }[]
  return rows.map((row) => ({
    id: row.id,
    path: row.path,
    addedAt: row.added_at,
    lastIndexedAt: row.last_indexed_at,
    fileCount: row.file_count,
    indexedCount: row.indexed_count ?? 0,
    skippedCount: row.skipped_count ?? 0
  }))
}

export function removeFolder(db: Db, id: number): void {
  db.prepare('DELETE FROM folders WHERE id = ?').run(id)
}

export function touchFolder(db: Db, id: number): void {
  db.prepare('UPDATE folders SET last_indexed_at = ? WHERE id = ?').run(Date.now(), id)
}

interface StoredFile {
  id: number
  size: number
  mtime: number
  status: FileStatus
}

/**
 * Inserts or refreshes one file row. A file whose size and mtime are unchanged
 * is left untouched so incremental runs only re-read what actually changed.
 */
export function upsertFile(db: Db, folderId: number, entry: WalkEntry): { id: number; changed: boolean } {
  const key = pathKey(entry.path)
  const mtime = Math.round(entry.mtimeMs)
  const existing = db
    .prepare('SELECT id, size, mtime, status FROM files WHERE path_key = ?')
    .get(key) as StoredFile | undefined

  if (existing) {
    if (existing.size === entry.size && existing.mtime === mtime) {
      return { id: existing.id, changed: existing.status === 'pending' }
    }
    db.prepare(
      `UPDATE files
          SET name = ?, name_norm = ?, parent_path = ?, parent_norm = ?, ext = ?,
              size = ?, mtime = ?, status = 'pending', skip_reason = NULL, indexed_at = NULL
        WHERE id = ?`
    ).run(
      entry.name,
      normalize(entry.name),
      parentOf(entry.path),
      normalize(parentOf(entry.path)),
      extensionOf(entry.name),
      entry.size,
      mtime,
      existing.id
    )
    db.prepare('DELETE FROM chunks WHERE file_id = ?').run(existing.id)
    return { id: existing.id, changed: true }
  }

  const info = db
    .prepare(
      `INSERT INTO files
         (folder_id, path, path_key, name, name_norm, parent_path, parent_norm, ext, size, mtime, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`
    )
    .run(
      folderId,
      entry.path,
      key,
      entry.name,
      normalize(entry.name),
      parentOf(entry.path),
      normalize(parentOf(entry.path)),
      extensionOf(entry.name),
      entry.size,
      mtime
    )
  return { id: Number(info.lastInsertRowid), changed: true }
}

export function getFile(db: Db, id: number): FileRow | undefined {
  const row = db
    .prepare(
      `SELECT id, folder_id, path, path_key, name, ext, size, mtime, status, skip_reason
         FROM files WHERE id = ?`
    )
    .get(id) as
    | {
        id: number
        folder_id: number
        path: string
        path_key: string
        name: string
        ext: string
        size: number
        mtime: number
        status: FileStatus
        skip_reason: string | null
      }
    | undefined
  if (!row) return undefined
  return {
    id: row.id,
    folderId: row.folder_id,
    path: row.path,
    pathKey: row.path_key,
    name: row.name,
    ext: row.ext,
    size: row.size,
    mtime: row.mtime,
    status: row.status,
    skipReason: row.skip_reason
  }
}

interface FileDbRow {
  id: number
  folder_id: number
  path: string
  path_key: string
  name: string
  ext: string
  size: number
  mtime: number
  status: FileStatus
  skip_reason: string | null
}

export function allFiles(db: Db): FileRow[] {
  const rows = db
    .prepare(
      `SELECT id, folder_id, path, path_key, name, ext, size, mtime, status, skip_reason
         FROM files ORDER BY id`
    )
    .all() as FileDbRow[]
  return rows.map(toFileRow)
}

function toFileRow(row: FileDbRow): FileRow {
  return {
    id: row.id,
    folderId: row.folder_id,
    path: row.path,
    pathKey: row.path_key,
    name: row.name,
    ext: row.ext,
    size: row.size,
    mtime: row.mtime,
    status: row.status,
    skipReason: row.skip_reason
  }
}

export function deleteMissingFiles(db: Db, folderId: number, seenKeys: Set<string>): number {
  const rows = db.prepare('SELECT id, path_key FROM files WHERE folder_id = ?').all(folderId) as {
    id: number
    path_key: string
  }[]
  const missing = rows.filter((row) => !seenKeys.has(row.path_key))
  if (missing.length === 0) return 0
  const remove = db.prepare('DELETE FROM files WHERE id = ?')
  db.transaction(() => {
    for (const row of missing) remove.run(row.id)
  })()
  return missing.length
}

export function setFileStatus(db: Db, id: number, status: FileStatus, skipReason: SkipReasonCode | string | null): void {
  db.prepare('UPDATE files SET status = ?, skip_reason = ?, indexed_at = ? WHERE id = ?').run(
    status,
    skipReason,
    status === 'indexed' ? Date.now() : null,
    id
  )
}

export function replaceChunks(db: Db, fileId: number, chunks: Chunk[]): void {
  const insert = db.prepare(
    'INSERT INTO chunks (file_id, seq, text_raw, text_norm, source) VALUES (?, ?, ?, ?, ?)'
  )
  db.transaction(() => {
    db.prepare('DELETE FROM chunks WHERE file_id = ?').run(fileId)
    chunks.forEach((chunk, seq) => {
      insert.run(fileId, seq, chunk.textRaw, chunk.textNorm, 'text')
    })
  })()
}

export function addLog(
  db: Db,
  level: LogLevel,
  path: string | null,
  code: SkipReasonCode | string | null,
  message: string
): LogEntry {
  const info = db
    .prepare('INSERT INTO index_log (ts, level, path, code, message) VALUES (?, ?, ?, ?, ?)')
    .run(Date.now(), level, path, code, message)
  return { id: Number(info.lastInsertRowid), ts: Date.now(), level, path, code, message }
}

export function listLogs(db: Db, limit: number): LogEntry[] {
  const rows = db
    .prepare('SELECT id, ts, level, path, code, message FROM index_log ORDER BY id DESC LIMIT ?')
    .all(limit) as LogEntry[]
  return rows
}

export function clearLogs(db: Db): void {
  db.prepare('DELETE FROM index_log').run()
}

export function getStats(db: Db, dbSizeBytes: number): IndexStats {
  const row = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM folders) AS folders,
         (SELECT COUNT(*) FROM files) AS files,
         (SELECT COUNT(*) FROM files WHERE status = 'indexed') AS indexed,
         (SELECT COUNT(*) FROM files WHERE status = 'name_only') AS name_only,
         (SELECT COUNT(*) FROM files WHERE status = 'skipped') AS skipped,
         (SELECT COUNT(*) FROM files WHERE status = 'error') AS errored,
         (SELECT COUNT(*) FROM files WHERE status = 'pending') AS pending,
         (SELECT COUNT(*) FROM chunks) AS chunks`
    )
    .get() as {
    folders: number
    files: number
    indexed: number
    name_only: number
    skipped: number
    errored: number
    pending: number
    chunks: number
  }
  return {
    folders: row.folders,
    files: row.files,
    indexed: row.indexed,
    nameOnly: row.name_only,
    skipped: row.skipped,
    errored: row.errored,
    pending: row.pending,
    chunks: row.chunks,
    dbSizeBytes
  }
}
