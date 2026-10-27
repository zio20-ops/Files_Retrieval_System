import type {
  AppInfo,
  FolderSummary,
  IndexProgress,
  IndexStats,
  LogEntry,
  PickFoldersResult,
  SearchRequest,
  SearchResponse,
  ShellResult
} from './types'

export const IPC = {
  getAppInfo: 'app:get-info',
  pickFolders: 'folders:pick',
  listFolders: 'folders:list',
  removeFolder: 'folders:remove',
  openFolder: 'shell:open-folder',
  startIndex: 'index:start',
  cancelIndex: 'index:cancel',
  getIndexProgress: 'index:progress-get',
  getIndexStats: 'index:stats',
  refreshFile: 'index:refresh-file',
  ocrFile: 'index:ocr-file',
  search: 'search:query',
  openFile: 'shell:open-file',
  revealFile: 'shell:reveal-file',
  openParentFolder: 'shell:open-parent',
  listLogs: 'logs:list',
  clearLogs: 'logs:clear',
  progressEvent: 'index:progress-event',
  logEvent: 'index:log-event'
} as const

export const IPC_CHANNELS = Object.values(IPC)

export type IndexMode = 'full' | 'incremental'

export interface AppCoreApi {
  getAppInfo(): Promise<AppInfo>
}

export interface AppFoldersApi {
  pickFolders(): Promise<PickFoldersResult>
  listFolders(): Promise<FolderSummary[]>
  removeFolder(id: number): Promise<void>
}

export interface AppIndexApi {
  startIndex(mode: IndexMode): Promise<void>
  cancelIndex(): Promise<void>
  getIndexProgress(): Promise<IndexProgress>
  getIndexStats(): Promise<IndexStats>
  listLogs(limit: number): Promise<LogEntry[]>
  clearLogs(): Promise<void>
  onIndexProgress(listener: (progress: IndexProgress) => void): () => void
  onIndexLog(listener: (entry: LogEntry) => void): () => void
  /** Re-reads one file (after the user saved it in Word/Excel/…) without a full run. */
  refreshFile(id: number): Promise<void>
  /** Re-processes one PDF through OCR on the user's explicit request. */
  ocrFile(id: number): Promise<void>
}

export interface AppShellApi {
  /** Opens the original file with the Windows default program. */
  openFile(id: number): Promise<ShellResult>
  /** Opens File Explorer with the original file selected. */
  revealFile(id: number): Promise<ShellResult>
  /** Opens the folder that contains the file. */
  openParentFolder(id: number): Promise<ShellResult>
  /** Opens an indexed root folder in File Explorer. */
  openFolder(id: number): Promise<ShellResult>
}

export interface AppSearchApi {
  search(request: SearchRequest): Promise<SearchResponse>
}

/** The API surface exposed on `window.api`. */
export interface AppBridgeApi
  extends AppCoreApi,
    AppFoldersApi,
    AppIndexApi,
    AppSearchApi,
    AppShellApi {}
