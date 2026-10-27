import { readdir, stat } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { join } from 'node:path'
import type { SkipRules } from './skipRules'

export interface WalkEntry {
  path: string
  name: string
  isDirectory: boolean
  size: number
  mtimeMs: number
}

export interface WalkOptions {
  rules: SkipRules
  maxDepth?: number
  isCancelled?: () => boolean
  onSkipped?: (path: string, reason: string) => void
}

const DEFAULT_MAX_DEPTH = 48

/**
 * Depth-first, streaming traversal. Directories are yielded so callers can
 * count them, but only files are stored in the index. Symlinks and junctions
 * are never followed: a folder tree that loops back on itself would otherwise
 * make the indexer run forever.
 */
export async function* walkDirectory(root: string, options: WalkOptions): AsyncGenerator<WalkEntry> {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH
  const stack: { path: string; depth: number }[] = [{ path: root, depth: 0 }]

  while (stack.length > 0) {
    if (options.isCancelled?.()) return
    const current = stack.pop() as { path: string; depth: number }

    let entries: Dirent<string>[]
    try {
      entries = await readdir(current.path, { withFileTypes: true })
    } catch (error) {
      options.onSkipped?.(current.path, readFailureReason(error))
      continue
    }

    for (const entry of entries) {
      const absolute = join(current.path, entry.name)

      if (entry.isSymbolicLink() || entry.isFIFO() || entry.isSocket()) {
        options.onSkipped?.(absolute, 'reparse_point')
        continue
      }

      if (entry.isDirectory()) {
        const reason = options.rules.shouldSkipDirectory(entry.name, absolute)
        if (reason) {
          options.onSkipped?.(absolute, reason)
          continue
        }
        if (current.depth + 1 > maxDepth) {
          options.onSkipped?.(absolute, 'max_depth')
          continue
        }
        yield { path: absolute, name: entry.name, isDirectory: true, size: 0, mtimeMs: 0 }
        stack.push({ path: absolute, depth: current.depth + 1 })
        continue
      }

      if (!entry.isFile()) continue

      const reason = options.rules.shouldSkipFile(entry.name)
      if (reason) {
        options.onSkipped?.(absolute, reason)
        continue
      }

      let stats: Awaited<ReturnType<typeof stat>>
      try {
        stats = await stat(absolute)
      } catch (error) {
        options.onSkipped?.(absolute, readFailureReason(error))
        continue
      }
      yield {
        path: absolute,
        name: entry.name,
        isDirectory: false,
        size: stats.size,
        mtimeMs: stats.mtimeMs
      }
    }
  }
}

export function readFailureReason(error: unknown): string {
  const code = (error as NodeJS.ErrnoException | null)?.code
  if (code === 'EPERM' || code === 'EACCES') return 'access_denied'
  if (code === 'ENOENT' || code === 'ENOTDIR') return 'missing'
  if (code === 'EBUSY') return 'file_in_use'
  return 'read_error'
}
