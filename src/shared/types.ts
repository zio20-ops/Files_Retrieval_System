export type FileStatus = 'pending' | 'indexed' | 'name_only' | 'skipped' | 'error'

export type SkipReasonCode =
  | 'unsupported_type'
  | 'too_large'
  | 'empty_file'
  | 'no_text_layer'
  | 'password_protected'
  | 'corrupt'
  | 'missing'
  | 'file_in_use'
  | 'access_denied'
  | 'read_error'
  | 'ocr_failed'

export type LogLevel = 'info' | 'warn' | 'error'

export interface LogEntry {
  id: number
  ts: number
  level: LogLevel
  path: string | null
  code: SkipReasonCode | string | null
  message: string
}

export interface AppInfo {
  version: string
  dbPath: string
  sqliteVersion: string
  fts5: boolean
  ocrAvailable: boolean
  ocrLanguages: string
  ocrTessdataPath: string | null
}

export interface IndexStats {
  folders: number
  files: number
  indexed: number
  nameOnly: number
  skipped: number
  errored: number
  pending: number
  chunks: number
  dbSizeBytes: number
}

export interface FolderSummary {
  id: number
  path: string
  addedAt: number
  lastIndexedAt: number | null
  fileCount: number
  indexedCount: number
  skippedCount: number
}

export interface PickFoldersResult {
  added: FolderSummary[]
  duplicates: string[]
  errors: { path: string; message: string }[]
}

export type IndexPhase =
  | 'idle'
  | 'scanning'
  | 'extracting'
  | 'finalizing'
  | 'done'
  | 'cancelled'
  | 'error'

/** Which page of a scanned document the OCR engine is reading right now. */
export interface OcrProgressInfo {
  page: number
  pages: number
}

export interface IndexProgress {
  phase: IndexPhase
  scanned: number
  toExtract: number
  extracted: number
  skipped: number
  failed: number
  currentFile: string | null
  ocr: OcrProgressInfo | null
  startedAt: number | null
  finishedAt: number | null
  error: string | null
}

export type SortKey = 'relevance' | 'name' | 'modified' | 'size'
export type SortDirection = 'asc' | 'desc'

export interface SearchRequest {
  query: string
  sort: SortKey
  direction: SortDirection
  extensions: string[]
  folderIds: number[]
  limit: number
  offset: number
}

export interface SnippetPart {
  text: string
  hit: boolean
}

export type MatchLocation = 'name' | 'path' | 'content'

export interface SearchResult {
  id: number
  name: string
  path: string
  parentPath: string
  ext: string
  size: number
  modifiedAt: number
  folderPath: string
  status: FileStatus
  skipReason: SkipReasonCode | string | null
  matchIn: MatchLocation[]
  snippet: SnippetPart[] | null
}

export interface FacetCount {
  key: string
  label: string
  count: number
}

export interface SearchResponse {
  query: string
  ftsExpression: string
  total: number
  tookMs: number
  results: SearchResult[]
  extensionFacets: FacetCount[]
  folderFacets: FacetCount[]
}

/**
 * Outcome of handing a path to Windows. The renderer only ever sends index ids,
 * never paths, so a stale or tampered row cannot turn into an arbitrary open.
 */
export type ShellErrorCode = 'missing' | 'not_directory' | 'open_failed' | 'not_indexed'

export interface ShellResult {
  ok: boolean
  code: ShellErrorCode | null
  detail: string | null
}
