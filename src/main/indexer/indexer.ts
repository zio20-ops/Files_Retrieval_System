import type { IndexProgress, LogEntry, LogLevel } from '@shared/types'
import type { IndexMode } from '@shared/ipc'
import type { Db } from '../db/database'
import * as repo from '../db/repository'
import type { ExtractorRegistry } from '../extractors/registry'
import { pathKey } from '../utils/paths'
import { chunkText } from './chunker'
import { createSkipRules, type SkipRules } from './skipRules'
import { walkDirectory } from './walk'

export interface IndexerEvents {
  onProgress: (progress: IndexProgress) => void
  onLog: (entry: LogEntry) => void
}

export function idleProgress(): IndexProgress {
  return {
    phase: 'idle',
    scanned: 0,
    toExtract: 0,
    extracted: 0,
    skipped: 0,
    failed: 0,
    currentFile: null,
    ocr: null,
    startedAt: null,
    finishedAt: null,
    error: null
  }
}

export interface ExtractOptions {
  forceOcr?: boolean
}

const PROGRESS_EMIT_INTERVAL_MS = 120

/**
 * Owns the whole indexing lifecycle: scan the selected folders, detect what
 * changed, extract content for the types we understand, and report progress.
 * A corrupt or protected file never aborts the run; it is recorded with a
 * reason in the index log and the run continues with the next file.
 */
export class Indexer {
  private progress: IndexProgress = idleProgress()
  private cancelled = false
  private running = false
  private lastEmit = 0
  private readonly rules: SkipRules

  constructor(
    private readonly db: Db,
    private readonly registry: ExtractorRegistry,
    private readonly events: IndexerEvents,
    env: Record<string, string | undefined> = process.env
  ) {
    this.rules = createSkipRules(env)
  }

  get current(): IndexProgress {
    return { ...this.progress }
  }

  get isRunning(): boolean {
    return this.running
  }

  cancel(): void {
    this.cancelled = true
  }

  /**
   * Re-reads a single file after the user saved it in Word/Excel/a PDF editor,
   * so the new content becomes searchable without re-walking every folder.
   */
  async refreshOne(fileId: number, options: ExtractOptions = {}): Promise<void> {
    if (this.running) throw new Error('An index run is already in progress')
    const row = repo.getFile(this.db, fileId)
    if (!row) throw new Error('This file is no longer in the index')

    this.running = true
    this.cancelled = false
    this.progress = { ...idleProgress(), phase: 'extracting', toExtract: 1, startedAt: Date.now() }
    this.emit()

    try {
      await this.extractAll([row], options)
      this.progress.phase = this.cancelled ? 'cancelled' : 'done'
      this.progress.finishedAt = Date.now()
      this.progress.currentFile = null
      this.emit()
    } catch (error) {
      this.progress.phase = 'error'
      this.progress.error = error instanceof Error ? error.message : String(error)
      this.progress.finishedAt = Date.now()
      this.progress.currentFile = null
      this.emit()
      throw error
    } finally {
      this.running = false
    }
  }

  async run(mode: IndexMode): Promise<void> {
    if (this.running) throw new Error('An index run is already in progress')
    this.running = true
    this.cancelled = false
    this.progress = { ...idleProgress(), phase: 'scanning', startedAt: Date.now() }
    this.emit()

    try {
      const pending = await this.scan(mode)
      if (!this.cancelled) await this.extractAll(pending)
      this.progress.phase = this.cancelled ? 'cancelled' : 'done'
      this.progress.finishedAt = Date.now()
      this.progress.currentFile = null
      this.emit()
    } catch (error) {
      this.progress.phase = 'error'
      this.progress.error = error instanceof Error ? error.message : String(error)
      this.progress.finishedAt = Date.now()
      this.progress.currentFile = null
      this.emit()
      throw error
    } finally {
      this.running = false
    }
  }

  private async scan(mode: IndexMode): Promise<repo.FileRow[]> {
    const folders = repo.listFolders(this.db)
    const changedIds: number[] = []

    for (const folder of folders) {
      if (this.cancelled) break
      const seen = new Set<string>()

      for await (const entry of walkDirectory(folder.path, {
        rules: this.rules,
        isCancelled: () => this.cancelled,
        onSkipped: (path, reason) =>
          this.log('warn', path, reason, `Not indexed during scan (${reason})`)
      })) {
        if (entry.isDirectory) continue
        seen.add(pathKey(entry.path))
        const { id, changed } = repo.upsertFile(this.db, folder.id, entry)
        if (changed) changedIds.push(id)
        this.progress.scanned += 1
        this.emitThrottled()
      }

      const removed = repo.deleteMissingFiles(this.db, folder.id, seen)
      if (removed > 0) {
        this.log(
          'info',
          folder.path,
          null,
          `${removed} file(s) no longer present on disk were removed from the index`
        )
      }
      repo.touchFolder(this.db, folder.id)
    }

    if (mode === 'full') return repo.allFiles(this.db)
    return changedIds
      .map((id) => repo.getFile(this.db, id))
      .filter((row): row is repo.FileRow => row !== undefined)
  }

  private async extractAll(files: repo.FileRow[], options: ExtractOptions = {}): Promise<void> {
    this.progress.phase = 'extracting'
    this.progress.toExtract = files.length
    this.emit()

    const context = {
      isCancelled: () => this.cancelled,
      forceOcr: options.forceOcr === true,
      reportOcr: (info: IndexProgress['ocr']) => {
        this.progress.ocr = info
        this.emit()
      }
    }

    for (const file of files) {
      if (this.cancelled) break
      this.progress.currentFile = file.path

      const extractor = this.registry.forExtension(file.ext)
      if (!extractor) {
        repo.setFileStatus(this.db, file.id, 'name_only', 'unsupported_type')
        this.progress.skipped += 1
        this.emitThrottled()
        continue
      }

      try {
        const outcome = await extractor.extract(file.path, context)
        if (outcome.kind === 'text') {
          const { chunks, truncated } = chunkText(outcome.text)
          repo.replaceChunks(this.db, file.id, chunks)
          repo.setFileStatus(this.db, file.id, 'indexed', null)
          if (truncated) {
            this.log(
              'warn',
              file.path,
              'too_large',
              'Document text exceeded the chunk cap; only the first part is searchable'
            )
          }
          this.progress.extracted += 1
        } else {
          repo.setFileStatus(this.db, file.id, 'skipped', outcome.reason)
          this.log('warn', file.path, outcome.reason, outcome.message)
          this.progress.skipped += 1
        }
      } catch (error) {
        repo.setFileStatus(this.db, file.id, 'error', 'read_error')
        this.log(
          'error',
          file.path,
          'read_error',
          error instanceof Error ? error.message : String(error)
        )
        this.progress.failed += 1
      }
      this.progress.ocr = null
      this.emitThrottled()
    }

    this.progress.currentFile = null
  }

  private log(
    level: LogLevel,
    path: string | null,
    code: string | null,
    message: string
  ): void {
    this.events.onLog(repo.addLog(this.db, level, path, code, message))
  }

  private emit(): void {
    this.lastEmit = Date.now()
    this.events.onProgress(this.current)
  }

  private emitThrottled(): void {
    if (Date.now() - this.lastEmit >= PROGRESS_EMIT_INTERVAL_MS) this.emit()
  }
}
