import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { openDatabase, type Db } from '@main/db/database'
import * as repo from '@main/db/repository'
import { registerBuiltinExtractors } from '@main/extractors'
import { OcrService } from '@main/ocr/ocrService'
import { ExtractorRegistry } from '@main/extractors/registry'
import { Indexer } from '@main/indexer/indexer'
import { parseQuery } from '@main/search/query'
import { runSearch as search } from '@main/search/search'
import type { SearchRequest, SearchResult } from '@shared/types'
import { ARABIC_PARAGRAPHS, ENGLISH_PARAGRAPHS, buildDocx, generateFixtures } from '../scripts/fixtures/generate.mjs'
import { makeTempRoot, writeTreeFile } from './helpers/tree'

const root = makeTempRoot('search-docs')
const secondRoot = makeTempRoot('search-docs-2')
const dbPath = join(process.cwd(), '.tmp', 'tests', 'search-index.db')

let db: Db
let folderId: number
let secondFolderId: number

function request(query: string, overrides: Partial<SearchRequest> = {}): SearchRequest {
  return {
    query,
    sort: 'relevance',
    direction: 'desc',
    extensions: [],
    folderIds: [],
    limit: 20,
    offset: 0,
    ...overrides
  }
}

function namesOf(results: SearchResult[]): string[] {
  return results.map((result) => result.name)
}

function snippetOf(results: SearchResult[], name: string): string {
  const found = results.find((result) => result.name === name)
  if (!found?.snippet) return ''
  return found.snippet.map((part) => part.text).join('')
}

function addFolder(path: string): number {
  const outcome = repo.addFolder(db, path)
  return 'folder' in outcome ? outcome.folder.id : outcome.duplicateOf
}

beforeAll(async () => {
  rmSync(dbPath, { force: true })
  generateFixtures(root)

  // Name/path variants: tashkeel, hamza carriers and a nested Arabic folder.
  copyFileSync(join(root, 'arabic-report.docx'), join(root, 'تقريرُ الإتفاقيةِ.docx'))
  writeFileSync(join(root, 'mixed.docx'), buildDocx([...ARABIC_PARAGRAPHS, ...ENGLISH_PARAGRAPHS]))
  const nested = join(root, 'مشاريع', 'الفرع الأول')
  mkdirSync(nested, { recursive: true })
  writeFileSync(
    join(nested, 'ملاحظاتُ المشروعِ.docx'),
    buildDocx([...ARABIC_PARAGRAPHS, 'الميزانيةُ الكبرى لسنةِ ٢٠٢٦'])
  )
  writeTreeFile(root, 'notes.txt', 'plain text is only searchable by name')

  writeFileSync(join(secondRoot, 'second-folder.docx'), buildDocx(['عقدُ الإيجارِ السنويِّ']))

  db = openDatabase(dbPath)
  const registry = new ExtractorRegistry()
  registerBuiltinExtractors(registry, new OcrService(null))
  folderId = addFolder(root)
  secondFolderId = addFolder(secondRoot)

  const indexer = new Indexer(db, registry, { onProgress: () => {}, onLog: () => {} })
  await indexer.run('full')
}, 120000)

describe('query parsing', () => {
  it('normalizes bare words into prefix-matched phrases', () => {
    const parsed = parseQuery('الإتّفاقيةُ report')
    expect(parsed.tokens).toEqual(['الاتفاقيه', 'report'])
    expect(parsed.expression).toBe('"الاتفاقيه"* AND "report"*')
    expect(parsed.isEmpty).toBe(false)
  })

  it('keeps quoted text as an exact phrase', () => {
    const parsed = parseQuery('"التعاونِ بينَ"')
    expect(parsed.phrases).toEqual(['التعاون بين'])
    expect(parsed.expression).toBe('"التعاون بين"')
  })

  it('treats a query of marks and spaces as empty', () => {
    expect(parseQuery(' ُ  ').isEmpty).toBe(true)
    expect(parseQuery('').expression).toBe('')
  })
})

describe('Arabic content search', () => {
  it('finds text written with tashkeel using a plain query', () => {
    const response = search(db, request('اتفاقية'))
    expect(namesOf(response.results)).toContain('arabic-report.docx')
    const hit = response.results.find((result) => result.name === 'arabic-report.docx')!
    expect(hit.matchIn).toContain('content')
  })

  it('finds the same text when the query carries tashkeel and a hamza', () => {
    const response = search(db, request('الإتّفاقيةُ'))
    expect(namesOf(response.results)).toContain('arabic-report.docx')
  })

  it('treats ta marbuta and heh as the same letter', () => {
    const withTa = search(db, request('اتفاقية'))
    const withHeh = search(db, request('اتفاقيه'))
    expect(namesOf(withHeh.results).sort()).toEqual(namesOf(withTa.results).sort())
  })

  it('treats alef maksura and yeh as the same letter', () => {
    const withAlef = search(db, request('على'))
    const withYeh = search(db, request('علي'))
    expect(namesOf(withAlef.results)).toContain('arabic-report.docx')
    expect(namesOf(withYeh.results).sort()).toEqual(namesOf(withAlef.results).sort())
  })

  it('matches Arabic-Indic digits against ASCII digits', () => {
    const response = search(db, request('2026'))
    expect(namesOf(response.results)).toContain('ملاحظاتُ المشروعِ.docx')
  })

  it('matches a word by its prefix', () => {
    const response = search(db, request('اتفاق'))
    expect(namesOf(response.results)).toContain('arabic-report.docx')
  })

  it('finds an exact phrase regardless of diacritics, and rejects a reordered one', () => {
    expect(namesOf(search(db, request('"التعاونِ بينَ"')).results)).toContain('arabic-report.docx')
    expect(search(db, request('"بينَ التعاونِ"')).total).toBe(0)
  })

  it('combines Arabic and English words in one query', () => {
    const response = search(db, request('اتفاقية committee'))
    expect(namesOf(response.results)).toEqual(['mixed.docx'])
  })
})

describe('name and path search', () => {
  it('finds a file by its English name', () => {
    const response = search(db, request('arabic-report'))
    const hit = response.results.find((result) => result.name === 'arabic-report.docx')!
    expect(hit.matchIn).toContain('name')
  })

  it('finds an Arabic file name written without tashkeel or hamza', () => {
    const response = search(db, request('تقرير الاتفاقية'))
    expect(namesOf(response.results)).toContain('تقريرُ الإتفاقيةِ.docx')
  })

  it('finds a file through its folder name', () => {
    const response = search(db, request('الفرع'))
    const hit = response.results.find((result) => result.name === 'ملاحظاتُ المشروعِ.docx')!
    expect(hit.matchIn).toContain('path')
  })

  it('matches unsupported types by name only, with no snippet', () => {
    const response = search(db, request('notes'))
    const hit = response.results.find((result) => result.name === 'notes.txt')!
    expect(hit.status).toBe('name_only')
    expect(hit.matchIn).toEqual(['name'])
    expect(hit.snippet).toBeNull()
  })

  it('does not claim a content match for a scanned PDF', () => {
    const response = search(db, request('scanned'))
    const hit = response.results.find((result) => result.name === 'scanned.pdf')!
    expect(hit.matchIn).not.toContain('content')
  })

  it('returns nothing for a term that is not indexed', () => {
    expect(search(db, request('qqqzzz')).total).toBe(0)
  })

  it('returns an empty response for an empty query', () => {
    const response = search(db, request(' ُ '))
    expect(response.total).toBe(0)
    expect(response.results).toEqual([])
    expect(response.extensionFacets).toEqual([])
  })
})

describe('results', () => {
  it('builds a snippet that keeps the original diacritics and flags the match', () => {
    const response = search(db, request('اتفاقية'))
    const snippet = snippetOf(response.results, 'arabic-report.docx')
    expect(snippet).toContain('اتفاقيةُ')
    const parts = response.results.find((result) => result.name === 'arabic-report.docx')!.snippet!
    expect(parts.some((part) => part.hit)).toBe(true)
    expect(parts.filter((part) => part.hit).map((part) => part.text).join('')).toContain('اتفاقيةُ')
  })

  it('reports the file metadata the UI needs', () => {
    const response = search(db, request('budget'))
    const hit = response.results.find((result) => result.name === 'report.pdf')!
    expect(hit.path).toBe(join(root, 'report.pdf'))
    expect(hit.parentPath).toBe(root)
    expect(hit.folderPath).toBe(root)
    expect(hit.ext).toBe('pdf')
    expect(hit.size).toBeGreaterThan(0)
    expect(hit.modifiedAt).toBeGreaterThan(0)
    expect(response.query).toBe('budget')
    expect(response.tookMs).toBeGreaterThanOrEqual(0)
  })

  it('filters by extension', () => {
    const response = search(db, request('report', { extensions: ['pdf'] }))
    expect(response.total).toBeGreaterThan(0)
    expect(response.results.every((result) => result.ext === 'pdf')).toBe(true)
  })

  it('filters by folder', () => {
    const response = search(db, request('عقد', { folderIds: [secondFolderId] }))
    expect(namesOf(response.results)).toEqual(['second-folder.docx'])
    expect(search(db, request('عقد', { folderIds: [folderId] })).total).toBe(0)
  })

  it('counts facets over the unfiltered match set', () => {
    const response = search(db, request('report', { extensions: ['pdf'] }))
    const docx = response.extensionFacets.find((facet) => facet.key === 'docx')
    expect(docx).toBeDefined()
    expect(docx!.label).toBe('DOCX')
    expect(response.folderFacets.map((facet) => facet.label)).toContain(root)
    const facetTotal = response.extensionFacets.reduce((sum, facet) => sum + facet.count, 0)
    expect(facetTotal).toBeGreaterThanOrEqual(response.total)
  })

  it('sorts by name in both directions', () => {
    const query = 'report'
    const ascending = namesOf(search(db, request(query, { sort: 'name', direction: 'asc' })).results)
    const descending = namesOf(search(db, request(query, { sort: 'name', direction: 'desc' })).results)
    expect(ascending).toEqual([...ascending].sort((a, b) => a.localeCompare(b)))
    expect(descending).toEqual([...ascending].reverse())
  })

  it('sorts by size and by modified date', () => {
    const bySize = search(db, request('report', { sort: 'size', direction: 'asc' })).results
    const sizes = bySize.map((result) => result.size)
    expect(sizes).toEqual([...sizes].sort((a, b) => a - b))

    const byModified = search(db, request('report', { sort: 'modified', direction: 'desc' })).results
    const times = byModified.map((result) => result.modifiedAt)
    expect(times).toEqual([...times].sort((a, b) => b - a))
  })

  it('pages through the matches', () => {
    const all = search(db, request('report'))
    expect(all.total).toBeGreaterThan(2)
    const first = search(db, request('report', { limit: 1 }))
    const second = search(db, request('report', { limit: 1, offset: 1 }))
    expect(first.results).toHaveLength(1)
    expect(first.total).toBe(all.total)
    expect(second.results[0].id).not.toBe(first.results[0].id)
  })
})
