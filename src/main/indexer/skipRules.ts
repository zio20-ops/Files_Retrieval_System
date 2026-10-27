import { pathKey } from '../utils/paths'

/**
 * Directory names that are never useful to index, regardless of location.
 * Hidden directories (leading dot) are skipped by the same rule set: they hold
 * tool state (.git, .cache, .venv), not work documents.
 */
const SKIPPED_DIR_NAMES: ReadonlySet<string> = new Set([
  '$recycle.bin',
  'system volume information',
  'winsxs',
  'config.msi',
  'msocache',
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  '__pycache__',
  '.cache',
  '.gradle',
  '.m2',
  '.nuget',
  '.terraform',
  'lost+found'
])

/** File names that are shell or application bookkeeping, not documents. */
const SKIPPED_FILE_NAMES: ReadonlySet<string> = new Set([
  'thumbs.db',
  'ehthumbs.db',
  'desktop.ini',
  '.ds_store'
])

/**
 * Windows exposes its sensitive roots through environment variables, so the
 * rule set is derived from the environment at startup and can be unit tested
 * with a synthetic environment.
 */
export function systemRootsFromEnv(env: Record<string, string | undefined>): string[] {
  const candidates = [
    env.SystemRoot,
    env.windir,
    env.ProgramFiles,
    env['ProgramFiles(x86)'],
    env.ProgramW6432,
    env.ProgramData,
    env.LOCALAPPDATA,
    env.APPDATA
  ]
  const roots: string[] = []
  for (const candidate of candidates) {
    if (!candidate) continue
    const key = pathKey(candidate)
    if (!roots.includes(key)) roots.push(key)
  }
  return roots
}

export interface SkipRules {
  roots: string[]
  shouldSkipDirectory(name: string, absolutePath: string): string | null
  shouldSkipFile(name: string): string | null
}

export function createSkipRules(env: Record<string, string | undefined>): SkipRules {
  const roots = systemRootsFromEnv(env)

  return {
    roots,
    shouldSkipDirectory(name, absolutePath) {
      const lower = name.toLowerCase()
      if (lower.startsWith('.')) return 'hidden_directory'
      if (SKIPPED_DIR_NAMES.has(lower)) return 'system_or_tooling_directory'
      const key = pathKey(absolutePath)
      if (key.includes('\\appdata\\')) return 'user_profile_appdata'
      for (const root of roots) {
        if (key === root || key.startsWith(`${root}\\`)) return 'system_directory'
      }
      return null
    },
    shouldSkipFile(name) {
      const lower = name.toLowerCase()
      if (lower.startsWith('.')) return 'hidden_file'
      if (lower.startsWith('~$')) return 'office_lock_file'
      if (SKIPPED_FILE_NAMES.has(lower)) return 'shell_bookkeeping_file'
      return null
    }
  }
}
