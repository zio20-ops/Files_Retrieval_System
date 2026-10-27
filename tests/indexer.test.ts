import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type Db } from '@main/db/database'
import * as repo from '@main/db/repository'
import { ExtractorRegistry, type Extractor } from '@main/extractors/registry'
import { fileErrorOutcome } from '@main/extractors/guards'
import { Indexer } from '@main/indexer/indexer'
import type { IndexProgress, LogEntry } from '@shared/types'
import { cleanupTempRoot, makeTempRoot, writeTreeFile } from './helpers/tree'

let db: Db
let root: string
let registry: ExtractorRegistry
let progress: IndexProgress[]
let logs: LogEntry[]

const stubText: Extractor = {
  id: 'stub',
  extensions: ['txt'],
  extract: async () => ({ kind: 'text', text: 'stub body text' })
}

const stubBroken: Extractor = {
  id: 'broken',
  extensions: ['broken'],
  extract: async () => ({ kind: 'skip', reason: 'corrupt', message: 'unreadable' })
}

const stubThrows: Extractor = {
  id: 'throws',
  extensions: ['boom'],
  extract: async () => {
    throw new Error('read failed')
  }
}

function makeIndexer(): Indexer {
  return new Indexer(
    db,
    registry,
    {
      onProgress: (entry) => progress.push(entry),
      onLog: (entry) => logs.push(entry)
    },
    { SystemRoot: 'C:\\Windows' }
  )
}

beforeEach(() => {
  db = openDatabase(':memory:')
  root = makeTempRoot('indexer')
  registry = new ExtractorRegistry()
  registry.register(stubText)
  registry.register(stubBroken)
  registry.register(stubThrows)
  progress = []
  logs = []
})

afterEach(() => {
  cleanupTempRoot(root)
})

describe('Indexer.run', () => {
  it('indexes names, extracts known types and reports unknown ones as name_only', async () => {
    writeTreeFile(root, 'notes.txt', 'hello')
    writeTreeFile(root, 'sub\\report.pdf', 'pdf bytes')
    writeTreeFile(root, 'sub\\data.broken', 'junk')
    writeTreeFile(root, 'sub\\crash.boom', 'junk')
    const added = repo.addFolder(db, root)
    if (!('folder' in added)) throw new Error('expected folder')

    await makeIndexer().run('full')

    const files = repo.allFiles(db).map((file) => [file.name, file.status])
    expect(files).toContainEqual(['notes.txt', 'indexed'])
    expect(files).toContainEqual(['report.pdf', 'name_only'])
    expect(files).toContainEqual(['data.broken', 'skipped'])
    expect(files).toContainEqual(['crash.boom', 'error'])

    const indexed = repo.allFiles(db).find((file) => file.name === 'notes.txt')
    if (!indexed) throw new Error('missing row')
    expect(
      db.prepare('SELECT text_raw FROM chunks WHERE file_id = ?').all(indexed.id)
    ).toEqual([{ text_raw: 'stub body text' }])

    const final = progress[progress.length - 1]
    expect(final.phase).toBe('done')
    expect(final.scanned).toBe(4)
    expect(final.extracted).toBe(1)
    expect(final.skipped).toBe(2)
    expect(final.failed).toBe(1)
  })

  it('logs a reason for every file it could not index and keeps going', async () => {
    writeTreeFile(root, 'a.broken')
    writeTreeFile(root, 'b.boom')
    writeTreeFile(root, 'c.txt')
    const added = repo.addFolder(db, root)
    if (!('folder' in added)) throw new Error('expected folder')

    await makeIndexer().run('full')

    expect(logs.map((log) => log.code)).toEqual(expect.arrayContaining(['corrupt', 'read_error']))
    expect(repo.allFiles(db).some((file) => file.status === 'indexed')).toBe(true)
    expect(repo.listLogs(db, 50).length).toBeGreaterThanOrEqual(2)
  })

  it('skips Windows system folders without touching them', async () => {
    writeTreeFile(root, 'Windows\\system32\\driver.txt')
    const windowsDir = join(root, 'Windows')
    const added = repo.addFolder(db, root)
    if (!('folder' in added)) throw new Error('expected folder')

    await new Indexer(
      db,
      registry,
      { onProgress: (entry) => progress.push(entry), onLog: (entry) => logs.push(entry) },
      { SystemRoot: windowsDir }
    ).run('full')

    expect(repo.allFiles(db)).toEqual([])
    expect(logs.some((log) => log.code === 'system_directory')).toBe(true)
  })

  it('re-reads only changed files on an incremental run', async () => {
    const unchanged = writeTreeFile(root, 'unchanged.txt', 'one')
    writeTreeFile(root, 'changed.txt', 'two')
    const added = repo.addFolder(db, root)
    if (!('folder' in added)) throw new Error('expected folder')

    await makeIndexer().run('full')
    const calls: string[] = []
    registry.register({
      id: 'counting',
      extensions: ['txt'],
      extract: async (path) => {
        calls.push(path)
        return { kind: 'text', text: 'body' }
      }
    })

    writeTreeFile(root, 'changed.txt', 'two but longer')
    progress = []
    await makeIndexer().run('incremental')

    expect(calls).toEqual([join(root, 'changed.txt')])
    expect(calls).not.toContain(unchanged)
    expect(progress[progress.length - 1].toExtract).toBe(1)
  })

  it('drops index rows for files deleted from disk', async () => {
    writeTreeFile(root, 'keep.txt')
    const gone = writeTreeFile(root, 'gone.txt')
    const added = repo.addFolder(db, root)
    if (!('folder' in added)) throw new Error('expected folder')

    await makeIndexer().run('full')
    expect(repo.allFiles(db)).toHaveLength(2)

    rmSync(gone)
    await makeIndexer().run('incremental')

    expect(repo.allFiles(db).map((file) => file.path)).toEqual([join(root, 'keep.txt')])
  })

  it('refuses to start a second run while one is active', async () => {
    writeTreeFile(root, 'a.txt')
    const added = repo.addFolder(db, root)
    if (!('folder' in added)) throw new Error('expected folder')
    const indexer = makeIndexer()
    const first = indexer.run('full')
    await expect(indexer.run('full')).rejects.toThrow(/already in progress/)
    await first
  })

  it('stops cleanly when cancelled', async () => {
    for (let i = 0; i < 20; i += 1) writeTreeFile(root, `file-${i}.txt`, 'x')
    const added = repo.addFolder(db, root)
    if (!('folder' in added)) throw new Error('expected folder')
    const indexer = makeIndexer()
    registry.register({
      id: 'cancelling',
      extensions: ['txt'],
      extract: async () => {
        indexer.cancel()
        return { kind: 'text', text: 'body' }
      }
    })

    await indexer.run('full')

    const final = progress[progress.length - 1]
    expect(final.phase).toBe('cancelled')
    expect(final.extracted).toBeLessThan(20)
  })

  it('surfaces progress through the stats view', async () => {
    writeTreeFile(root, 'a.txt')
    writeTreeFile(root, 'b.pdf')
    const added = repo.addFolder(db, root)
    if (!('folder' in added)) throw new Error('expected folder')

    await makeIndexer().run('full')

    const stats = repo.getStats(db, 0)
    expect(stats.folders).toBe(1)
    expect(stats.files).toBe(2)
    expect(stats.indexed).toBe(1)
    expect(stats.nameOnly).toBe(1)
    expect(stats.chunks).toBe(1)
    expect(stats.pending).toBe(0)
  })
})

function chunkTexts(database: Db, fileId: number): string[] {
  return (
    database.prepare('SELECT text_raw FROM chunks WHERE file_id = ? ORDER BY seq').all(fileId) as {
      text_raw: string
    }[]
  ).map((row) => row.text_raw)
}

describe('Indexer.refreshOne', () => {
  const readsDisk: Extractor = {
    id: 'disk',
    extensions: ['txt'],
    extract: async (path) => {
      try {
        return { kind: 'text', text: readFileSync(path, 'utf8') }
      } catch (cause) {
        // Same mapping the real extractors use: ENOENT becomes a skip, not a crash.
        return (
          fileErrorOutcome(cause) ?? { kind: 'skip', reason: 'read_error', message: String(cause) }
        )
      }
    }
  }

  it('re-reads only the refreshed file and picks up the saved content', async () => {
    registry.register(readsDisk)
    writeTreeFile(root, 'other.txt', 'other body')
    writeTreeFile(root, 'editable.txt', 'first version')
    const added = repo.addFolder(db, root)
    if (!('folder' in added)) throw new Error('expected folder')

    await makeIndexer().run('full')
    const row = repo.allFiles(db).find((file) => file.name === 'editable.txt')
    if (!row) throw new Error('missing row')
    expect(chunkTexts(db, row.id)).toEqual(['first version'])

    writeTreeFile(root, 'editable.txt', 'second version with fresh numbers')
    progress = []
    await makeIndexer().refreshOne(row.id)

    expect(chunkTexts(db, row.id)).toEqual(['second version with fresh numbers'])
    const other = repo.allFiles(db).find((file) => file.name === 'other.txt')
    if (!other) throw new Error('missing row')
    expect(chunkTexts(db, other.id)).toEqual(['other body'])
    expect(progress[progress.length - 1].toExtract).toBe(1)
    expect(progress[progress.length - 1].phase).toBe('done')
  })

  it('reports a file deleted outside the app as missing without throwing', async () => {
    registry.register(readsDisk)
    const path = writeTreeFile(root, 'gone.txt', 'body')
    const added = repo.addFolder(db, root)
    if (!('folder' in added)) throw new Error('expected folder')

    await makeIndexer().run('full')
    const row = repo.allFiles(db).find((file) => file.name === 'gone.txt')
    if (!row) throw new Error('missing row')

    rmSync(path)
    await makeIndexer().refreshOne(row.id)

    const refreshed = repo.getFile(db, row.id)
    expect(refreshed?.status).toBe('skipped')
    expect(refreshed?.skipReason).toBe('missing')
    expect(logs.some((log) => log.code === 'missing')).toBe(true)
  })

  it('refuses to refresh while a full run is active', async () => {
    writeTreeFile(root, 'a.txt')
    const added = repo.addFolder(db, root)
    if (!('folder' in added)) throw new Error('expected folder')
    const indexer = makeIndexer()
    const first = indexer.run('full')
    await expect(indexer.refreshOne(1)).rejects.toThrow(/already in progress/)
    await first
  })

  it('rejects an id that is not in the index', async () => {
    await expect(makeIndexer().refreshOne(999)).rejects.toThrow(/no longer in the index/)
  })
})
