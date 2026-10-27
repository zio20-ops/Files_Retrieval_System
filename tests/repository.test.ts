import { beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type Db } from '@main/db/database'
import * as repo from '@main/db/repository'
import type { WalkEntry } from '@main/indexer/walk'

let db: Db

beforeEach(() => {
  db = openDatabase(':memory:')
})

function entry(path: string, size = 10, mtimeMs = 1000): WalkEntry {
  const name = path.split('\\').pop() as string
  return { path, name, isDirectory: false, size, mtimeMs }
}

describe('folders', () => {
  it('adds a folder and detects a duplicate by normalized path', () => {
    const first = repo.addFolder(db, 'C:\\Work')
    expect('folder' in first).toBe(true)
    const duplicate = repo.addFolder(db, 'c:\\work\\')
    expect('duplicateOf' in duplicate).toBe(true)
  })

  it('reports per-folder counts', () => {
    const added = repo.addFolder(db, 'C:\\Work')
    if (!('folder' in added)) throw new Error('expected folder')
    repo.upsertFile(db, added.folder.id, entry('C:\\Work\\a.docx'))
    repo.upsertFile(db, added.folder.id, entry('C:\\Work\\b.pdf'))
    repo.setFileStatus(db, 1, 'indexed', null)
    repo.setFileStatus(db, 2, 'skipped', 'corrupt')

    const [summary] = repo.listFolders(db)
    expect(summary.fileCount).toBe(2)
    expect(summary.indexedCount).toBe(1)
    expect(summary.skippedCount).toBe(1)
  })
})

describe('upsertFile', () => {
  it('inserts new files as pending', () => {
    const added = repo.addFolder(db, 'C:\\Work')
    if (!('folder' in added)) throw new Error('expected folder')
    const result = repo.upsertFile(db, added.folder.id, entry('C:\\Work\\a.docx'))
    expect(result.changed).toBe(true)
    const row = repo.getFile(db, result.id)
    expect(row?.status).toBe('pending')
    expect(row?.ext).toBe('docx')
    expect(row?.name).toBe('a.docx')
    expect(db.prepare('SELECT name_norm FROM files WHERE id = ?').get(result.id)).toEqual({
      name_norm: 'a.docx'
    })
  })

  it('treats an unchanged file as unchanged once it has been processed', () => {
    const added = repo.addFolder(db, 'C:\\Work')
    if (!('folder' in added)) throw new Error('expected folder')
    const { id } = repo.upsertFile(db, added.folder.id, entry('C:\\Work\\a.docx'))
    repo.setFileStatus(db, id, 'indexed', null)

    expect(repo.upsertFile(db, added.folder.id, entry('C:\\Work\\a.docx')).changed).toBe(false)
  })

  it('detects a modification through size or mtime and resets to pending', () => {
    const added = repo.addFolder(db, 'C:\\Work')
    if (!('folder' in added)) throw new Error('expected folder')
    const { id } = repo.upsertFile(db, added.folder.id, entry('C:\\Work\\a.docx'))
    repo.setFileStatus(db, id, 'indexed', null)
    repo.replaceChunks(db, id, [{ textRaw: 'old', textNorm: 'old' }])

    const changed = repo.upsertFile(db, added.folder.id, entry('C:\\Work\\a.docx', 99, 5000))
    expect(changed.changed).toBe(true)
    expect(changed.id).toBe(id)
    expect(repo.getFile(db, id)?.status).toBe('pending')
    expect(db.prepare('SELECT COUNT(*) AS c FROM chunks WHERE file_id = ?').get(id)).toEqual({ c: 0 })
  })

  it('is case-insensitive about Windows paths', () => {
    const added = repo.addFolder(db, 'C:\\Work')
    if (!('folder' in added)) throw new Error('expected folder')
    const first = repo.upsertFile(db, added.folder.id, entry('C:\\Work\\A.docx'))
    const second = repo.upsertFile(db, added.folder.id, entry('c:\\work\\a.DOCX'))
    expect(second.id).toBe(first.id)
  })
})

describe('deleteMissingFiles', () => {
  it('removes files that disappeared from disk', () => {
    const added = repo.addFolder(db, 'C:\\Work')
    if (!('folder' in added)) throw new Error('expected folder')
    repo.upsertFile(db, added.folder.id, entry('C:\\Work\\keep.docx'))
    repo.upsertFile(db, added.folder.id, entry('C:\\Work\\gone.docx'))

    const removed = repo.deleteMissingFiles(db, added.folder.id, new Set(['c:\\work\\keep.docx']))
    expect(removed).toBe(1)
    expect(repo.listFolders(db)[0].fileCount).toBe(1)
  })
})

describe('chunks and FTS synchronization', () => {
  it('keeps the FTS index in step with chunk rows', () => {
    const added = repo.addFolder(db, 'C:\\Work')
    if (!('folder' in added)) throw new Error('expected folder')
    const { id } = repo.upsertFile(db, added.folder.id, entry('C:\\Work\\a.docx'))
    repo.replaceChunks(db, id, [
      { textRaw: 'quarterly report', textNorm: 'quarterly report' },
      { textRaw: 'ملفات الشركة', textNorm: 'ملفات الشركه' }
    ])

    expect(
      db.prepare("SELECT COUNT(*) AS c FROM chunks_fts WHERE chunks_fts MATCH 'quarterly'").get()
    ).toEqual({ c: 1 })
    expect(
      db.prepare("SELECT COUNT(*) AS c FROM chunks_fts WHERE chunks_fts MATCH 'ملفات'").get()
    ).toEqual({ c: 1 })

    repo.replaceChunks(db, id, [{ textRaw: 'replaced', textNorm: 'replaced' }])
    expect(db.prepare("SELECT COUNT(*) AS c FROM chunks_fts WHERE chunks_fts MATCH 'quarterly'").get()).toEqual({ c: 0 })
    expect(db.prepare("SELECT COUNT(*) AS c FROM chunks_fts WHERE chunks_fts MATCH 'replaced'").get()).toEqual({ c: 1 })
  })

  it('drops name and chunk index rows when a folder is removed', () => {
    const added = repo.addFolder(db, 'C:\\Work')
    if (!('folder' in added)) throw new Error('expected folder')
    const { id } = repo.upsertFile(db, added.folder.id, entry('C:\\Work\\a.docx'))
    repo.replaceChunks(db, id, [{ textRaw: 'quarterly', textNorm: 'quarterly' }])

    repo.removeFolder(db, added.folder.id)

    expect(db.prepare('SELECT COUNT(*) AS c FROM files').get()).toEqual({ c: 0 })
    expect(db.prepare('SELECT COUNT(*) AS c FROM chunks').get()).toEqual({ c: 0 })
    expect(db.prepare('SELECT COUNT(*) AS c FROM chunks_fts').get()).toEqual({ c: 0 })
    expect(db.prepare('SELECT COUNT(*) AS c FROM names_fts').get()).toEqual({ c: 0 })
  })
})

describe('index log', () => {
  it('stores, lists newest-first and clears', () => {
    repo.addLog(db, 'warn', 'C:\\Work\\a.pdf', 'password_protected', 'needs a password')
    repo.addLog(db, 'error', 'C:\\Work\\b.pdf', 'corrupt', 'broken')

    const logs = repo.listLogs(db, 10)
    expect(logs.map((log) => log.level)).toEqual(['error', 'warn'])
    expect(logs[0].code).toBe('corrupt')

    repo.clearLogs(db)
    expect(repo.listLogs(db, 10)).toEqual([])
  })
})

describe('stats', () => {
  it('aggregates statuses and chunk counts', () => {
    const added = repo.addFolder(db, 'C:\\Work')
    if (!('folder' in added)) throw new Error('expected folder')
    const a = repo.upsertFile(db, added.folder.id, entry('C:\\Work\\a.docx'))
    const b = repo.upsertFile(db, added.folder.id, entry('C:\\Work\\b.pdf'))
    repo.setFileStatus(db, a.id, 'indexed', null)
    repo.replaceChunks(db, a.id, [{ textRaw: 'x', textNorm: 'x' }])
    repo.setFileStatus(db, b.id, 'skipped', 'corrupt')

    const stats = repo.getStats(db, 1234)
    expect(stats.folders).toBe(1)
    expect(stats.files).toBe(2)
    expect(stats.indexed).toBe(1)
    expect(stats.skipped).toBe(1)
    expect(stats.chunks).toBe(1)
    expect(stats.dbSizeBytes).toBe(1234)
  })
})
