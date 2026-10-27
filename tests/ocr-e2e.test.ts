import { copyFileSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { openDatabase, type Db } from '@main/db/database'
import * as repo from '@main/db/repository'
import { createPdfExtractor } from '@main/extractors/pdf'
import type { Extractor } from '@main/extractors/registry'
import { ExtractorRegistry } from '@main/extractors/registry'
import { Indexer } from '@main/indexer/indexer'
import { resolveOcrAssets } from '@main/ocr/assets'
import { extractPageImages } from '@main/ocr/pdfImages'
import { OcrCancelledError, OcrService } from '@main/ocr/ocrService'
import { runSearch } from '@main/search/search'
import type { IndexProgress } from '@shared/types'
import { makeTempRoot, cleanupTempRoot } from './helpers/tree'

const scannedFixture = join(process.cwd(), 'tests', 'fixtures', 'scanned-ara-eng.pdf')

const stubText: Extractor = {
  id: 'stub',
  extensions: ['txt'],
  extract: async () => ({ kind: 'text', text: 'plain note body' })
}

const service = new OcrService(resolveOcrAssets())

afterAll(async () => {
  await service.dispose()
})

function searchFor(db: Db, query: string): number {
  return runSearch(db, {
    query,
    sort: 'relevance',
    direction: 'desc',
    extensions: [],
    folderIds: [],
    limit: 50,
    offset: 0
  }).total
}

describe('real Tesseract OCR (ara+eng)', () => {
  it('indexes a scanned PDF and makes its Arabic and English words searchable', async () => {
    expect(service.available).toBe(true)

    const root = makeTempRoot('ocr-e2e')
    copyFileSync(scannedFixture, join(root, 'scanned-invoice.pdf'))
    writeFileSync(join(root, 'corrupt.pdf'), Buffer.from('%PDF-1.4\nnot a real pdf at all'))
    writeFileSync(join(root, 'notes.txt'), 'plain note')

    const db = openDatabase(':memory:')
    const registry = new ExtractorRegistry()
    registry.register(createPdfExtractor(service))
    registry.register(stubText)
    repo.addFolder(db, root)

    const progress: IndexProgress[] = []
    const indexer = new Indexer(db, registry, {
      onProgress: (entry) => progress.push(entry),
      onLog: () => undefined
    })
    await indexer.run('full')

    const files = new Map(repo.allFiles(db).map((file) => [file.name, file]))
    expect(files.get('scanned-invoice.pdf')?.status).toBe('indexed')
    expect(files.get('corrupt.pdf')?.status).toBe('skipped')
    expect(files.get('notes.txt')?.status).toBe('indexed')

    const scannedId = files.get('scanned-invoice.pdf')?.id
    if (scannedId === undefined) throw new Error('scanned row missing')
    const ocrText = (
      db.prepare('SELECT text_raw FROM chunks WHERE file_id = ?').all(scannedId) as {
        text_raw: string
      }[]
    )
      .map((row) => row.text_raw)
      .join('\n')
    console.log(`[ocr-e2e] recognised text >>> ${ocrText.replace(/\n/g, ' | ')}`)

    expect(ocrText).toMatch(/zebra/i)
    expect(ocrText).toMatch(/quartz/i)
    expect(ocrText).toContain('الفاتورة')
    expect(ocrText).toContain('الميزانية')

    expect(progress.some((entry) => entry.ocr !== null && entry.ocr.pages === 2)).toBe(true)

    expect(searchFor(db, 'zebra')).toBeGreaterThanOrEqual(1)
    expect(searchFor(db, 'الفاتورة')).toBeGreaterThanOrEqual(1)

    cleanupTempRoot(root)
  }, 300_000)

  it('cancels an in-flight OCR safely and the engine keeps working afterwards', async () => {
    const data = new Uint8Array(readFileSync(scannedFixture))
    const loadingTask = getDocument({ data, useWorkerFetch: false, disableFontFace: true })
    const document = await loadingTask.promise
    const images: Buffer[] = []
    try {
      for (const number of [1, 2]) {
        const page = await document.getPage(number)
        try {
          images.push(...(await extractPageImages(page)))
        } finally {
          page.cleanup()
        }
      }
    } finally {
      await loadingTask.destroy()
    }
    expect(images).toHaveLength(2)

    let cancelled = false
    const running = service.recognizeImages(
      images,
      (info) => {
        // The Stop button flips the indexer flag; the engine notices at the
        // next page boundary and unwinds without losing the index state.
        if (info.page === 1) cancelled = true
      },
      () => cancelled
    )
    await expect(running).rejects.toBeInstanceOf(OcrCancelledError)

    const text = await service.recognizeImages([images[0]], () => undefined, () => false)
    expect(text).toMatch(/zebra/i)
  }, 300_000)
})
