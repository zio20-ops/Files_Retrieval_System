import { statSync } from 'node:fs'
import type { ShellErrorCode, ShellResult } from '@shared/types'
import type { Db } from './db/database'
import * as repo from './db/repository'
import { parentOf } from './utils/paths'

export type ResolvedTarget = { ok: true; path: string } | { ok: false; code: ShellErrorCode }

/**
 * Paths are always resolved from the index, never accepted from the renderer,
 * and re-checked on disk right before Windows is asked to open them. A file the
 * user deleted or moved outside the app therefore reports `missing` instead of
 * surfacing a raw filesystem error.
 */
function existingFile(path: string): ResolvedTarget {
  try {
    return statSync(path).isFile() ? { ok: true, path } : { ok: false, code: 'missing' }
  } catch {
    return { ok: false, code: 'missing' }
  }
}

function existingDirectory(path: string): ResolvedTarget {
  try {
    return statSync(path).isDirectory() ? { ok: true, path } : { ok: false, code: 'not_directory' }
  } catch {
    return { ok: false, code: 'not_directory' }
  }
}

export function resolveFilePath(db: Db, id: number): ResolvedTarget {
  const row = repo.getFile(db, id)
  if (!row) return { ok: false, code: 'not_indexed' }
  return existingFile(row.path)
}

export function resolveParentPath(db: Db, id: number): ResolvedTarget {
  const row = repo.getFile(db, id)
  if (!row) return { ok: false, code: 'not_indexed' }
  return existingDirectory(parentOf(row.path))
}

export function resolveFolderPath(db: Db, id: number): ResolvedTarget {
  const folder = repo.getFolder(db, id)
  if (!folder) return { ok: false, code: 'not_indexed' }
  return existingDirectory(folder.path)
}

export function shellOk(): ShellResult {
  return { ok: true, code: null, detail: null }
}

export function shellFailure(code: ShellErrorCode, detail: string | null): ShellResult {
  return { ok: false, code, detail }
}

export function failureOf(target: Extract<ResolvedTarget, { ok: false }>): ShellResult {
  return shellFailure(target.code, null)
}
