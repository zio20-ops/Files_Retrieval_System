import type {
  FacetCount,
  FileStatus,
  MatchLocation,
  SearchRequest,
  SearchResponse,
  SearchResult,
  SnippetPart
} from '@shared/types'
import type { Db } from '../db/database'
import { parseQuery } from './query'
import { buildSnippet, findHits } from './snippet'

/**
 * Cap on the number of FTS rows pulled into memory per query. Facets and
 * sorting are computed in JS (bm25 ranks from two different tables cannot be
 * compared inside SQL), so an unbounded match set would blow up on huge
 * indexes. 5000 well-ranked candidates is far more than a user pages through.
 */
const MATCH_LIMIT = 5000

/** File names are worth more than body text when both match. */
const NAME_WEIGHT = 6
const PARENT_WEIGHT = 1

interface Candidate {
  fileId: number
  relevance: number
  bestChunkId: number | null
}

interface FileDbRow {
  id: number
  folder_id: number
  folder_path: string
  name: string
  name_norm: string
  path: string
  parent_path: string
  parent_norm: string
  ext: string
  size: number
  mtime: number
  status: FileStatus
  skip_reason: string | null
}

const FILE_COLUMNS = `
  f.id, f.folder_id, f.name, f.name_norm, f.path, f.parent_path, f.parent_norm,
  f.ext, f.size, f.mtime, f.status, f.skip_reason, fo.path AS folder_path`

function fetchFiles(db: Db, ids: number[]): FileDbRow[] {
  const rows: FileDbRow[] = []
  for (let start = 0; start < ids.length; start += 500) {
    const batch = ids.slice(start, start + 500)
    const placeholders = batch.map(() => '?').join(', ')
    const found = db
      .prepare(
        `SELECT ${FILE_COLUMNS}
           FROM files f
           JOIN folders fo ON fo.id = f.folder_id
          WHERE f.id IN (${placeholders})`
      )
      .all(...batch) as FileDbRow[]
    rows.push(...found)
  }
  return rows
}

interface FileScore {
  nameScore: number
  matchedClauses: number
  /** Accumulated bm25 rank per chunk; the lowest total is the best chunk. */
  chunks: Map<number, number>
}

/**
 * Matches every clause on its own, then keeps the files that satisfied all of
 * them. A single `AND` expression would only match when every word sits inside
 * the same indexed chunk, so a document whose file name carries one query word
 * and whose body carries another would be missed.
 *
 * bm25 ranks are negative and larger means better, so each is summed as `-rank`
 * to produce a positive relevance score.
 */
function collectCandidates(db: Db, clauses: string[]): Map<number, Candidate> {
  const nameStatement = db.prepare(
    `SELECT rowid AS id, bm25(names_fts, ${NAME_WEIGHT}, ${PARENT_WEIGHT}) AS rank
       FROM names_fts
      WHERE names_fts MATCH ?
      ORDER BY rank
      LIMIT ?`
  )
  const chunkStatement = db.prepare(
    `SELECT c.file_id AS file_id, k.rowid AS chunk_id, bm25(chunks_fts) AS rank
       FROM chunks_fts k
       JOIN chunks c ON c.id = k.rowid
      WHERE chunks_fts MATCH ?
      ORDER BY rank
      LIMIT ?`
  )

  const scores = new Map<number, FileScore>()
  const scoreOf = (id: number): FileScore => {
    let entry = scores.get(id)
    if (!entry) {
      entry = { nameScore: 0, matchedClauses: 0, chunks: new Map() }
      scores.set(id, entry)
    }
    return entry
  }

  for (const clause of clauses) {
    const matched = new Set<number>()

    for (const row of nameStatement.all(clause, MATCH_LIMIT) as { id: number; rank: number }[]) {
      scoreOf(row.id).nameScore += -row.rank
      matched.add(row.id)
    }
    for (const row of chunkStatement.all(clause, MATCH_LIMIT) as {
      file_id: number
      chunk_id: number
      rank: number
    }[]) {
      const entry = scoreOf(row.file_id)
      entry.chunks.set(row.chunk_id, (entry.chunks.get(row.chunk_id) ?? 0) + row.rank)
      matched.add(row.file_id)
    }
    for (const id of matched) scoreOf(id).matchedClauses += 1
  }

  const candidates = new Map<number, Candidate>()
  for (const [fileId, entry] of scores) {
    if (entry.matchedClauses < clauses.length) continue

    let bestChunkId: number | null = null
    let bestRank = Number.POSITIVE_INFINITY
    for (const [chunkId, rank] of entry.chunks) {
      if (rank < bestRank) {
        bestRank = rank
        bestChunkId = chunkId
      }
    }

    candidates.set(fileId, {
      fileId,
      relevance: entry.nameScore + (bestChunkId === null ? 0 : -bestRank),
      bestChunkId
    })
  }
  return candidates
}

function countBy(rows: FileDbRow[], keyOf: (row: FileDbRow) => string, labelOf: (row: FileDbRow) => string): FacetCount[] {
  const counts = new Map<string, FacetCount>()
  for (const row of rows) {
    const key = keyOf(row)
    const facet = counts.get(key)
    if (facet) facet.count++
    else counts.set(key, { key, label: labelOf(row), count: 1 })
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}

/**
 * Every comparator sorts ascending; `direction === 'desc'` reverses the list,
 * which turns relevance into best-first and name into Z→A.
 */
function comparator(sort: SearchRequest['sort']): (a: Scored, b: Scored) => number {
  const byName = (a: Scored, b: Scored): number => a.row.name.localeCompare(b.row.name)
  switch (sort) {
    case 'name':
      return byName
    case 'modified':
      return (a, b) => a.row.mtime - b.row.mtime || byName(a, b)
    case 'size':
      return (a, b) => a.row.size - b.row.size || byName(a, b)
    default:
      return (a, b) => a.candidate.relevance - b.candidate.relevance || byName(a, b)
  }
}

interface Scored {
  row: FileDbRow
  candidate: Candidate
}

export function runSearch(db: Db, request: SearchRequest): SearchResponse {
  const startedAt = Date.now()
  const parsed = parseQuery(request.query)
  const needles = [...parsed.tokens, ...parsed.phrases]
  const base: SearchResponse = {
    query: request.query,
    ftsExpression: parsed.expression,
    total: 0,
    tookMs: 0,
    results: [],
    extensionFacets: [],
    folderFacets: []
  }
  if (parsed.isEmpty) return { ...base, tookMs: Date.now() - startedAt }

  const candidates = collectCandidates(db, parsed.clauses)
  if (candidates.size === 0) return { ...base, tookMs: Date.now() - startedAt }

  const rows = fetchFiles(db, [...candidates.keys()])
  const scored: Scored[] = []
  for (const row of rows) {
    const candidate = candidates.get(row.id)
    if (!candidate) continue
    scored.push({ row, candidate })
  }
  const matched = scored.map((entry) => entry.row)

  const extensionFacets = countBy(
    matched,
    (row) => row.ext,
    (row) => (row.ext === '' ? 'other' : row.ext.toUpperCase())
  )
  const folderFacets = countBy(
    matched,
    (row) => String(row.folder_id),
    (row) => row.folder_path
  )

  const wantedExtensions = new Set(request.extensions.map((ext) => ext.toLowerCase()))
  const wantedFolders = new Set(request.folderIds)
  const filtered = scored.filter((entry) => {
    if (wantedExtensions.size > 0 && !wantedExtensions.has(entry.row.ext)) return false
    if (wantedFolders.size > 0 && !wantedFolders.has(entry.row.folder_id)) return false
    return true
  })

  const ordered = filtered.sort(comparator(request.sort))
  if (request.direction === 'desc') ordered.reverse()

  const limit = Math.max(1, Math.min(request.limit, 200))
  const offset = Math.max(0, request.offset)
  const page = ordered.slice(offset, offset + limit)

  const chunkText = db.prepare('SELECT text_raw FROM chunks WHERE id = ?')
  const results: SearchResult[] = page.map(({ row, candidate }) => {
    const matchIn: MatchLocation[] = []
    if (findHits(row.name, needles).length > 0) matchIn.push('name')
    if (findHits(row.parent_path, needles).length > 0) matchIn.push('path')

    let snippet: SnippetPart[] | null = null
    if (candidate.bestChunkId !== null) {
      const chunk = chunkText.get(candidate.bestChunkId) as { text_raw: string } | undefined
      const text = chunk?.text_raw ?? ''
      const hits = findHits(text, needles)
      if (hits.length > 0) {
        matchIn.push('content')
        snippet = buildSnippet(text, hits)
      }
    }

    return {
      id: row.id,
      name: row.name,
      path: row.path,
      parentPath: row.parent_path,
      ext: row.ext,
      size: row.size,
      modifiedAt: row.mtime,
      folderPath: row.folder_path,
      status: row.status,
      skipReason: row.skip_reason,
      matchIn,
      snippet
    }
  })

  return {
    query: request.query,
    ftsExpression: parsed.expression,
    total: filtered.length,
    tookMs: Date.now() - startedAt,
    results,
    extensionFacets,
    folderFacets
  }
}
