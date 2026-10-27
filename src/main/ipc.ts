import { BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import { databaseInfo, type Db } from './db/database'
import * as repo from './db/repository'
import { ExtractorRegistry } from './extractors/registry'
import { Indexer } from './indexer/indexer'
import type { OcrService } from './ocr/ocrService'
import { runSearch } from './search/search'
import {
  failureOf,
  resolveFilePath,
  resolveFolderPath,
  resolveParentPath,
  shellFailure,
  shellOk,
  type ResolvedTarget
} from './shell'
import { IPC, type IndexMode } from '@shared/ipc'
import type {
  AppInfo,
  IndexStats,
  PickFoldersResult,
  SearchRequest,
  SearchResponse,
  ShellResult,
  SortDirection,
  SortKey
} from '@shared/types'

export interface MainContext {
  db: Db
  dbPath: string
  version: string
  registry: ExtractorRegistry
  ocr: OcrService
}

const registered: string[] = []
let indexer: Indexer | null = null

function handle(
  channel: string,
  listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
): void {
  ipcMain.handle(channel, listener)
  registered.push(channel)
}

function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, payload)
  }
}

function stats(db: Db, dbPath: string): IndexStats {
  return repo.getStats(db, databaseInfo(db, dbPath).sizeBytes)
}

function asId(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error('Id must be a whole number')
  }
  return value
}

/**
 * Hands an index-resolved path to Windows. The app only asks the OS to open or
 * reveal it; the file itself is never copied, moved or edited here.
 */
async function openWithWindows(target: ResolvedTarget, label: string): Promise<ShellResult> {
  if (!target.ok) return failureOf(target)
  const error = await shell.openPath(target.path)
  console.log(`[shell] ${label} path=${target.path} result=${error === '' ? 'opened' : error}`)
  return error === '' ? shellOk() : shellFailure('open_failed', error)
}

const SORT_KEYS: readonly SortKey[] = ['relevance', 'name', 'modified', 'size']

/**
 * The renderer is ours, but a search request still crosses a process boundary,
 * so it is rebuilt from known-good pieces instead of being trusted as-is.
 */
function sanitizeSearchRequest(payload: unknown): SearchRequest {
  const input = (payload ?? {}) as Partial<SearchRequest>
  return {
    query: typeof input.query === 'string' ? input.query.slice(0, 500) : '',
    sort: SORT_KEYS.includes(input.sort as SortKey) ? (input.sort as SortKey) : 'relevance',
    direction: input.direction === 'asc' ? 'asc' : ('desc' as SortDirection),
    extensions: Array.isArray(input.extensions)
      ? input.extensions
          .filter((ext): ext is string => typeof ext === 'string')
          .slice(0, 50)
          .map((ext) => ext.replace(/^\./, '').toLowerCase().slice(0, 20))
      : [],
    folderIds: Array.isArray(input.folderIds)
      ? input.folderIds
          .filter((id): id is number => Number.isInteger(id))
          .slice(0, 200)
      : [],
    limit: typeof input.limit === 'number' ? Math.min(Math.max(1, Math.trunc(input.limit)), 200) : 50,
    offset: typeof input.offset === 'number' ? Math.max(0, Math.trunc(input.offset)) : 0
  }
}

export function registerIpc(ctx: MainContext): { indexer: Indexer } {
  const created = new Indexer(ctx.db, ctx.registry, {
    onProgress: (progress) => broadcast(IPC.progressEvent, progress),
    onLog: (entry) => broadcast(IPC.logEvent, entry)
  })
  indexer = created

  handle(IPC.getAppInfo, (): AppInfo => {
    const info = databaseInfo(ctx.db, ctx.dbPath)
    return {
      version: ctx.version,
      dbPath: ctx.dbPath,
      sqliteVersion: info.sqliteVersion,
      fts5: info.fts5,
      ocrAvailable: ctx.ocr.available,
      ocrLanguages: ctx.ocr.languages,
      ocrTessdataPath: ctx.ocr.tessdataPath
    }
  })

  handle(IPC.pickFolders, async (): Promise<PickFoldersResult> => {
    const options = {
      title: 'Select folders to index',
      buttonLabel: 'Add folder',
      properties: ['openDirectory', 'multiSelections'] as ('openDirectory' | 'multiSelections')[]
    }
    const parent = BrowserWindow.getFocusedWindow()
    const picked = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options)

    const result: PickFoldersResult = { added: [], duplicates: [], errors: [] }
    if (picked.canceled) return result

    const addedIds: number[] = []
    for (const path of picked.filePaths) {
      try {
        const outcome = repo.addFolder(ctx.db, path)
        if ('duplicateOf' in outcome) result.duplicates.push(path)
        else addedIds.push(outcome.folder.id)
      } catch (error) {
        result.errors.push({ path, message: error instanceof Error ? error.message : String(error) })
      }
    }
    result.added = repo.listFolders(ctx.db).filter((folder) => addedIds.includes(folder.id))
    return result
  })

  handle(IPC.listFolders, () => repo.listFolders(ctx.db))

  handle(IPC.removeFolder, (_event, id: unknown) => {
    if (typeof id !== 'number') throw new Error('Folder id must be a number')
    repo.removeFolder(ctx.db, id)
  })

  handle(IPC.startIndex, (_event, mode: unknown) => {
    const runMode: IndexMode = mode === 'full' ? 'full' : 'incremental'
    if (created.isRunning) return
    void created.run(runMode).catch((error) => {
      repo.addLog(ctx.db, 'error', null, 'read_error', String(error?.message ?? error))
    })
  })

  handle(IPC.cancelIndex, () => created.cancel())

  handle(IPC.getIndexProgress, () => created.current)

  handle(IPC.getIndexStats, () => stats(ctx.db, ctx.dbPath))

  handle(IPC.search, (_event, payload: unknown): SearchResponse =>
    runSearch(ctx.db, sanitizeSearchRequest(payload))
  )

  handle(IPC.openFile, (_event, id: unknown) =>
    openWithWindows(resolveFilePath(ctx.db, asId(id)), 'open file')
  )

  handle(IPC.revealFile, (_event, id: unknown): ShellResult => {
    const target = resolveFilePath(ctx.db, asId(id))
    if (!target.ok) return failureOf(target)
    shell.showItemInFolder(target.path)
    console.log(`[shell] reveal path=${target.path} result=selected in Explorer`)
    return shellOk()
  })

  handle(IPC.openParentFolder, (_event, id: unknown) =>
    openWithWindows(resolveParentPath(ctx.db, asId(id)), 'open parent folder')
  )

  handle(IPC.openFolder, (_event, id: unknown) =>
    openWithWindows(resolveFolderPath(ctx.db, asId(id)), 'open folder')
  )

  handle(IPC.refreshFile, async (_event, id: unknown) => {
    await created.refreshOne(asId(id))
  })

  handle(IPC.ocrFile, async (_event, id: unknown) => {
    await created.refreshOne(asId(id), { forceOcr: true })
  })

  handle(IPC.listLogs, (_event, limit: unknown) => {
    const safe = typeof limit === 'number' && limit > 0 ? Math.min(limit, 1000) : 200
    return repo.listLogs(ctx.db, safe)
  })

  handle(IPC.clearLogs, () => repo.clearLogs(ctx.db))

  return { indexer: created }
}

export function disposeIpc(): void {
  indexer?.cancel()
  indexer = null
  for (const channel of registered) ipcMain.removeHandler(channel)
  registered.length = 0
}
