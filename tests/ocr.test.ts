import { crc32 } from 'node:zlib'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { openDatabase, type Db } from '@main/db/database'
import * as repo from '@main/db/repository'
import { createPdfExtractor } from '@main/extractors/pdf'
import type { ExtractContext, Extractor, ExtractOutcome } from '@main/extractors/registry'
import { ExtractorRegistry } from '@main/extractors/registry'
import { Indexer } from '@main/indexer/indexer'
import { extractPageImages } from '@main/ocr/pdfImages'
import { OcrCancelledError, OcrFailedError, OcrService } from '@main/ocr/ocrService'
import { encodePng, type RawImage } from '@main/ocr/png'
import type { OcrProgressInfo } from '@shared/types'
import { generateFixtures } from '../scripts/fixtures/generate.mjs'
import { makeTempRoot } from './helpers/tree'

const scannedFixture = join(process.cwd(), 'tests', 'fixtures', 'scanned-ara-eng.pdf')
const root = makeTempRoot('ocr-fixtures')
const neverCancelled: ExtractContext = { isCancelled: () => false }

const stubText: Extractor = {
  id: 'stub',
  extensions: ['txt'],
  extract: async () => ({ kind: 'text', text: 'plain note body' })
}

/** Stands in for Tesseract so failure and cancellation paths stay fast and deterministic. */
class StubOcr extends OcrService {
  calls = 0
  constructor(
    private readonly mode: 'ok' | 'fail' | 'slow',
    private readonly text = 'zebra quadrant delta'
  ) {
    super(null)
  }

  override get available(): boolean {
    return true
  }

  override async recognizeImages(
    images: Buffer[],
    onPage: (info: OcrProgressInfo) => void,
    isCancelled: () => boolean
  ): Promise<string> {
    this.calls += 1
    for (let i = 0; i < images.length; i += 1) {
      if (isCancelled()) throw new OcrCancelledError()
      onPage({ page: i + 1, pages: images.length })
      if (this.mode === 'slow') {
        await new Promise((resolve) => setTimeout(resolve, 250))
        if (isCancelled()) throw new OcrCancelledError()
      }
      if (this.mode === 'fail') throw new OcrFailedError('engine exploded')
    }
    return this.text
  }
}

function textOf(outcome: ExtractOutcome): string {
  if (outcome.kind !== 'text') throw new Error(`expected text, got ${outcome.kind}`)
  return outcome.text
}

function skipOf(outcome: ExtractOutcome): string {
  if (outcome.kind !== 'skip') throw new Error(`expected skip, got ${outcome.kind}`)
  return outcome.reason
}

beforeAll(() => {
  generateFixtures(root)
})

describe('png encoder', () => {
  it('wraps raw samples into a truecolor PNG', () => {
    const image: RawImage = {
      width: 2,
      height: 2,
      kind: 2,
      data: new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255])
    }
    const png = encodePng(image)
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    expect(png.readUInt32BE(16)).toBe(2)
    expect(png.readUInt32BE(20)).toBe(2)
    expect(png[25]).toBe(2)

    const length = png.readUInt32BE(8)
    const body = png.subarray(12, 12 + length + 4)
    expect(png.readUInt32BE(12 + length + 4)).toBe(crc32(body.subarray(0, 4 + length)))
  })
})

describe('page image extraction', () => {
  it('finds the raster page of a scanned PDF', async () => {
    const data = new Uint8Array(readFileSync(scannedFixture))
    const loadingTask = getDocument({ data, useWorkerFetch: false, disableFontFace: true })
    const document = await loadingTask.promise
    try {
      const page = await document.getPage(1)
      const images = await extractPageImages(page)
      expect(images).toHaveLength(1)
      expect(images[0].readUInt32BE(16)).toBe(1240)
      expect(images[0].readUInt32BE(20)).toBe(1754)
    } finally {
      await loadingTask.destroy()
    }
  })
})

describe('pdf extractor OCR policy', () => {
  it('never runs OCR on a text PDF', async () => {
    const ocr = new StubOcr('ok')
    const outcome = await createPdfExtractor(ocr).extract(join(root, 'report.pdf'), neverCancelled)
    expect(textOf(outcome)).toContain('Quarterly sales report')
    expect(ocr.calls).toBe(0)
  })

  it('reports a scanned PDF as no_text_layer when OCR assets are missing', async () => {
    const outcome = await createPdfExtractor(new OcrService(null)).extract(
      scannedFixture,
      neverCancelled
    )
    expect(skipOf(outcome)).toBe('no_text_layer')
  })

  it('reads a scanned PDF through OCR and reports page progress', async () => {
    const ocr = new StubOcr('ok')
    const reports: OcrProgressInfo[] = []
    const context: ExtractContext = {
      isCancelled: () => false,
      reportOcr: (info) => reports.push(info)
    }
    const outcome = await createPdfExtractor(ocr).extract(scannedFixture, context)
    expect(textOf(outcome)).toContain('zebra quadrant delta')
    expect(ocr.calls).toBe(1)
    expect(reports).toEqual([
      { page: 1, pages: 2 },
      { page: 2, pages: 2 }
    ])
  })

  it('keeps the run alive when OCR fails for one file', async () => {
    const outcome = await createPdfExtractor(new StubOcr('fail')).extract(
      scannedFixture,
      neverCancelled
    )
    expect(skipOf(outcome)).toBe('ocr_failed')
  })

  it('reports a corrupt PDF without touching OCR', async () => {
    const ocr = new StubOcr('ok')
    const outcome = await createPdfExtractor(ocr).extract(join(root, 'corrupt.pdf'), neverCancelled)
    expect(skipOf(outcome)).toBe('corrupt')
    expect(ocr.calls).toBe(0)
  })

  it('stops safely when the user cancels mid-OCR', async () => {
    const ocr = new StubOcr('slow')
    let cancelled = false
    const context: ExtractContext = {
      isCancelled: () => cancelled,
      reportOcr: (info) => {
        if (info.page === 1) cancelled = true
      }
    }
    const outcome = await createPdfExtractor(ocr).extract(scannedFixture, context)
    expect(skipOf(outcome)).toBe('no_text_layer')
  })

  it('explains that a text PDF has nothing for OCR to read when the user forces it', async () => {
    const ocr = new StubOcr('ok')
    const outcome = await createPdfExtractor(ocr).extract(join(root, 'report.pdf'), {
      isCancelled: () => false,
      forceOcr: true
    })
    expect(skipOf(outcome)).toBe('no_text_layer')
    expect(ocr.calls).toBe(0)
  })
})

describe('Indexer with a failing OCR file', () => {
  it('logs the OCR failure and continues with the rest of the files', async () => {
    const db: Db = openDatabase(':memory:')
    const registry = new ExtractorRegistry()
    registry.register(createPdfExtractor(new StubOcr('fail')))
    registry.register(stubText)
    const folder = makeTempRoot('ocr-indexer')
    writeFileSync(join(folder, 'scanned.pdf'), readFileSync(scannedFixture))
    writeFileSync(join(folder, 'notes.txt'), 'plain note')
    repo.addFolder(db, folder)

    const indexer = new Indexer(db, registry, { onProgress: () => undefined, onLog: () => undefined })
    await indexer.run('full')

    const statuses = new Map(repo.allFiles(db).map((file) => [file.name, file.status]))
    expect(statuses.get('scanned.pdf')).toBe('skipped')
    expect(statuses.get('notes.txt')).toBe('indexed')
    expect(repo.allFiles(db).find((file) => file.name === 'scanned.pdf')?.skipReason).toBe(
      'ocr_failed'
    )
    expect(repo.listLogs(db, 50).some((log) => log.code === 'ocr_failed')).toBe(true)
    expect(indexer.current.phase).toBe('done')
  })
})
