import { normalize } from './normalize'

export interface ParsedQuery {
  /** FTS5 MATCH expression over the normalized columns. */
  expression: string
  /**
   * The same expression split back into its parts. Search matches each clause
   * separately and keeps the files that satisfied all of them, because a single
   * `AND` expression would require every word to sit in the same indexed chunk.
   */
  clauses: string[]
  /** Normalized bare words, used to highlight snippets. */
  tokens: string[]
  /** Normalized quoted phrases, used to highlight snippets. */
  phrases: string[]
  isEmpty: boolean
}

/** Bounds the work a very long query can ask for; each clause costs two FTS lookups. */
const MAX_CLAUSES = 32

function ftsQuote(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

/**
 * Quoted parts stay exact phrases; every other run of non-space characters
 * becomes a prefix-matched phrase so "اتفاق" also finds "اتفاقية" and "report"
 * finds "reports". Normalizing first is what makes Arabic spelling variants
 * collapse onto the indexed form.
 */
export function parseQuery(raw: string): ParsedQuery {
  const clauses: string[] = []
  const tokens: string[] = []
  const phrases: string[] = []
  const pattern = /"([^"]*)"|\S+/g

  for (const match of raw.matchAll(pattern)) {
    if (clauses.length >= MAX_CLAUSES) break
    const phrase = match[1]
    if (phrase !== undefined) {
      const normalized = normalize(phrase).trim()
      if (normalized.length === 0) continue
      phrases.push(normalized)
      clauses.push(ftsQuote(normalized))
      continue
    }
    const normalized = normalize(match[0]).trim()
    if (normalized.length === 0) continue
    tokens.push(normalized)
    clauses.push(`${ftsQuote(normalized)}*`)
  }

  return {
    expression: clauses.join(' AND '),
    clauses,
    tokens,
    phrases,
    isEmpty: clauses.length === 0
  }
}
