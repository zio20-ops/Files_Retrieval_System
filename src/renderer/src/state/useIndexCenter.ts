import { useCallback, useEffect, useState } from 'react'
import type { IndexMode } from '@shared/ipc'
import type { FolderSummary, IndexProgress, IndexStats, LogEntry } from '@shared/types'
import { isFinalPhase } from '../format'

export type Notice = { kind: 'duplicate' | 'removed'; path: string } | null

const LOG_LIMIT = 200

export interface IndexCenter {
  progress: IndexProgress | null
  stats: IndexStats | null
  folders: FolderSummary[]
  logs: LogEntry[]
  notice: Notice
  error: string | null
  running: boolean
  start(mode: IndexMode): void
  cancel(): void
  addFolders(): Promise<void>
  removeFolder(id: number, path: string): Promise<void>
  clearLogs(): Promise<void>
  reload(): Promise<void>
  dismissNotice(): void
}

/** Single source of truth for everything the workspace views show about the index. */
export function useIndexCenter(): IndexCenter {
  const [progress, setProgress] = useState<IndexProgress | null>(null)
  const [stats, setStats] = useState<IndexStats | null>(null)
  const [folders, setFolders] = useState<FolderSummary[]>([])
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [notice, setNotice] = useState<Notice>(null)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      const [nextProgress, nextStats, nextFolders, nextLogs] = await Promise.all([
        window.api.getIndexProgress(),
        window.api.getIndexStats(),
        window.api.listFolders(),
        window.api.listLogs(LOG_LIMIT)
      ])
      setProgress(nextProgress)
      setStats(nextStats)
      setFolders(nextFolders)
      setLogs(nextLogs)
      setError(null)
    } catch (cause) {
      setError(message(cause))
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  useEffect(
    () =>
      window.api.onIndexProgress((next) => {
        setProgress(next)
        if (isFinalPhase(next.phase)) void reload()
      }),
    [reload]
  )

  useEffect(
    () =>
      window.api.onIndexLog((entry) => {
        setLogs((prev) => [entry, ...prev.filter((item) => item.id !== entry.id)].slice(0, LOG_LIMIT))
      }),
    []
  )

  const guard = useCallback((run: () => Promise<unknown>) => {
    run().catch((cause) => setError(message(cause)))
  }, [])

  const addFolders = useCallback(async () => {
    try {
      const picked = await window.api.pickFolders()
      if (picked.duplicates.length > 0) {
        setNotice({ kind: 'duplicate', path: picked.duplicates[0] })
      } else if (picked.added.length > 0) {
        setNotice(null)
      }
      if (picked.errors.length > 0) setError(picked.errors[0].message)
      await reload()
    } catch (cause) {
      setError(message(cause))
    }
  }, [reload])

  const removeFolder = useCallback(
    async (id: number, path: string) => {
      try {
        await window.api.removeFolder(id)
        setNotice({ kind: 'removed', path })
        await reload()
      } catch (cause) {
        setError(message(cause))
      }
    },
    [reload]
  )

  const clearLogs = useCallback(async () => {
    try {
      await window.api.clearLogs()
      setLogs([])
    } catch (cause) {
      setError(message(cause))
    }
  }, [])

  return {
    progress,
    stats,
    folders,
    logs,
    notice,
    error,
    running: progress !== null && !isFinalPhase(progress.phase) && progress.phase !== 'idle',
    start: (mode) => guard(() => window.api.startIndex(mode)),
    cancel: () => guard(() => window.api.cancelIndex()),
    addFolders,
    removeFolder,
    clearLogs,
    reload,
    dismissNotice: () => setNotice(null)
  }
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
