import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type Db } from '@main/db/database'
import * as repo from '@main/db/repository'
import { resolveFilePath, resolveFolderPath, resolveParentPath } from '@main/shell'
import { cleanupTempRoot, makeTempRoot, writeTreeFile } from './helpers/tree'

let db: Db
let root: string
let folderId: number

function addFile(relative: string): { id: number; path: string } {
  const path = writeTreeFile(root, relative, 'x')
  const name = relative.split(/[\\/]/).pop() as string
  const { id } = repo.upsertFile(db, folderId, {
    path,
    name,
    isDirectory: false,
    size: 1,
    mtimeMs: 1
  })
  return { id, path }
}

beforeEach(() => {
  db = openDatabase(':memory:')
  root = makeTempRoot('shell')
  const added = repo.addFolder(db, root)
  if (!('folder' in added)) throw new Error('expected folder')
  folderId = added.folder.id
})

afterEach(() => {
  db.close()
  cleanupTempRoot(root)
})

describe('resolveFilePath', () => {
  it('returns the original path of an indexed file', () => {
    const file = addFile('report.docx')
    expect(resolveFilePath(db, file.id)).toEqual({ ok: true, path: file.path })
  })

  it('reports missing when the file was deleted outside the app', () => {
    const file = addFile('report.docx')
    rmSync(file.path)
    expect(resolveFilePath(db, file.id)).toEqual({ ok: false, code: 'missing' })
  })

  it('reports missing when the row points at a directory', () => {
    const dir = join(root, 'sub')
    mkdirSync(dir, { recursive: true })
    const { id } = repo.upsertFile(db, folderId, {
      path: dir,
      name: 'sub',
      isDirectory: false,
      size: 0,
      mtimeMs: 1
    })
    expect(resolveFilePath(db, id)).toEqual({ ok: false, code: 'missing' })
  })

  it('reports not_indexed for an unknown id', () => {
    expect(resolveFilePath(db, 4242)).toEqual({ ok: false, code: 'not_indexed' })
  })
})

describe('resolveParentPath', () => {
  it('returns the containing folder of a file', () => {
    const file = addFile(join('sub', 'report.docx'))
    expect(resolveParentPath(db, file.id)).toEqual({ ok: true, path: join(root, 'sub') })
  })

  it('reports not_directory when the folder was deleted outside the app', () => {
    const file = addFile(join('sub', 'report.docx'))
    rmSync(join(root, 'sub'), { recursive: true, force: true })
    expect(resolveParentPath(db, file.id)).toEqual({ ok: false, code: 'not_directory' })
  })
})

describe('resolveFolderPath', () => {
  it('returns the indexed root folder', () => {
    expect(resolveFolderPath(db, folderId)).toEqual({ ok: true, path: root })
  })

  it('reports not_directory when the root folder was deleted', () => {
    rmSync(root, { recursive: true, force: true })
    expect(resolveFolderPath(db, folderId)).toEqual({ ok: false, code: 'not_directory' })
  })

  it('reports not_indexed for an unknown folder id', () => {
    expect(resolveFolderPath(db, 999)).toEqual({ ok: false, code: 'not_indexed' })
  })
})
