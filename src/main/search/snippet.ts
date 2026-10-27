import type { SnippetPart } from '@shared/types'
import { expandLeadingRemoved, expandTrailingRemoved, normalizeWithMap } from './normalize'

export interface Hit {
  /** Inclusive start offset in the raw text. */
  start: number
  /** Exclusive end offset in the raw text. */
  end: number
}

const ELLIPSIS = '\u2026'

function mergeHits(hits: Hit[]): Hit[] {
  if (hits.length < 2) return hits
  hits.sort((a, b) => a.start - b.start || a.end - b.end)
  const merged: Hit[] = [{ ...hits[0] }]
  for (const hit of hits.slice(1)) {
    const last = merged[merged.length - 1]
    if (hit.start <= last.end) last.end = Math.max(last.end, hit.end)
    else merged.push({ ...hit })
  }
  return merged
}

/**
 * Locates normalized needles inside raw text and maps the matches back to raw
 * offsets, so highlighting keeps the user's original diacritics and hamza forms.
 * Needles must already be normalized (as `parseQuery` returns them); substring
 * matching means a prefix query such as "اتفاق" also lights up "اتفاقية".
 */
export function findHits(raw: string, needles: readonly string[]): Hit[] {
  if (raw.length === 0 || needles.length === 0) return []
  const { text, sourceIndex } = normalizeWithMap(raw)
  if (text.length === 0) return []

  const hits: Hit[] = []
  for (const needle of needles) {
    if (needle.length === 0) continue
    let at = text.indexOf(needle)
    while (at !== -1) {
      const start = expandLeadingRemoved(raw, sourceIndex[at])
      const end = expandTrailingRemoved(raw, sourceIndex[at + needle.length - 1] + 1)
      hits.push({ start, end })
      at = text.indexOf(needle, at + needle.length)
    }
  }
  return mergeHits(hits)
}

/** Moves a window start forward to the next space so a snippet never begins mid-word. */
function snapStart(raw: string, start: number): number {
  if (start === 0) return 0
  let next = start
  while (next < raw.length && !/\s/.test(raw[next])) next++
  while (next < raw.length && /\s/.test(raw[next])) next++
  return next < raw.length ? next : start
}

function flatten(text: string): string {
  return text.replace(/\s+/g, ' ')
}

function part(text: string, hit: boolean): SnippetPart | null {
  const value = flatten(text)
  return value.length === 0 ? null : { text: value, hit }
}

function join(parts: (SnippetPart | null)[]): SnippetPart[] {
  return parts.filter((entry): entry is SnippetPart => entry !== null)
}

/**
 * Renders a short window of `raw` around the first hits, with matched spans
 * flagged so the UI can wrap them in `<mark>` without re-parsing the query.
 * Returns null when there is nothing worth showing.
 */
export function buildSnippet(raw: string, hits: readonly Hit[], radius = 70): SnippetPart[] | null {
  if (raw.trim().length === 0) return null

  if (hits.length === 0) {
    const end = Math.min(raw.length, radius * 2)
    const parts = join([part(raw.slice(0, end), false)])
    if (parts.length === 0) return null
    if (end < raw.length) parts.push({ text: ` ${ELLIPSIS}`, hit: false })
    return parts
  }

  const first = hits[0]
  const start = snapStart(raw, Math.max(0, first.start - radius))
  let end = Math.min(raw.length, first.end + radius)
  for (const hit of hits) {
    if (hit.start > end) break
    end = Math.max(end, Math.min(raw.length, hit.end + radius))
  }

  const parts: (SnippetPart | null)[] = []
  if (start > 0) parts.push({ text: `${ELLIPSIS} `, hit: false })
  let cursor = start
  for (const hit of hits) {
    if (hit.end <= start) continue
    if (hit.start >= end) break
    const from = Math.max(hit.start, start)
    const to = Math.min(hit.end, end)
    parts.push(part(raw.slice(cursor, from), false))
    parts.push(part(raw.slice(from, to), true))
    cursor = to
  }
  parts.push(part(raw.slice(cursor, end), false))
  if (end < raw.length) parts.push({ text: ` ${ELLIPSIS}`, hit: false })

  const joined = join(parts)
  return joined.length === 0 ? null : joined
}
