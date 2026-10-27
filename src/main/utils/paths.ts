import { basename, dirname, sep } from 'node:path'

/**
 * Windows paths are case-insensitive and accept both separators, so a
 * canonical key is required before two paths can be compared for equality.
 * Without this, "C:\Work" and "c:\work\" would be indexed as two folders.
 */
export function pathKey(absolutePath: string): string {
  let key = absolutePath.replace(/\//g, '\\').toLowerCase()
  while (key.length > 1 && key.endsWith('\\')) key = key.slice(0, -1)
  return key
}

export function parentOf(absolutePath: string): string {
  return dirname(absolutePath)
}

export function nameOf(absolutePath: string): string {
  return basename(absolutePath)
}

/** Lowercase extension without the dot; empty string when there is none. */
export function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  if (dot <= 0 || dot === fileName.length - 1) return ''
  return fileName.slice(dot + 1).toLowerCase()
}

/** Short display form used in the UI: the last two path segments. */
export function shortPath(absolutePath: string, segments = 2): string {
  const parts = absolutePath.split(sep).filter(Boolean)
  if (parts.length <= segments) return absolutePath
  return `…${sep}${parts.slice(-segments).join(sep)}`
}
