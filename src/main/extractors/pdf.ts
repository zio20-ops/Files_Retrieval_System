import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { getDocument, type PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'
import {
  failureMessage,
  fileErrorOutcome,
  guardSize,
  readWholeFile,
  skip
} from './guards'
import type { ExtractContext, Extractor, ExtractOutcome } from './registry'
import { extractPageImages } from '../ocr/pdfImages'
import { OcrCancelledError, OcrService, OcrUnavailableError } from '../ocr/ocrService'

const MAX_BYTES = 200 * 1024 * 1024

/** pdfjs ships cmaps and standard fonts as loose files; locate them in dev and in a packaged app. */
function assetDir(subdir: string): string | undefined {
  // Outside Electron (unit tests) the `electron` module resolves to a string path.
  const appPath = typeof app?.getAppPath === 'function' ? app.getAppPath() : process.cwd()
  const candidates = [
    join(appPath, 'node_modules', 'pdfjs-dist', subdir),
    join(process.resourcesPath ?? '', 'pdfjs', subdir)
  ]
  const found = candidates.find((dir) => existsSync(dir))
  return found ? `${found}/` : undefined
}

/**
 * OCR runs only for PDFs whose text layer is empty (scanned pages), or when the
 * user explicitly asks through "Run OCR". Text PDFs never pay the OCR cost.
 */
async function ocrOutcome(
  document: PDFDocumentProxy,
  textLayer: string,
  ocr: OcrService,
  context: ExtractContext
): Promise<ExtractOutcome> {
  if (!ocr.available) {
    return skip(
      'no_text_layer',
      context.forceOcr
        ? 'OCR was requested but the OCR language data (ara+eng) is not installed on this machine'
        : 'The PDF has no selectable text (scanned pages) and the OCR language data is not installed'
    )
  }

  const images: Buffer[] = []
  for (let number = 1; number <= document.numPages; number += 1) {
    if (context.isCancelled()) break
    const page = await document.getPage(number)
    try {
      for (const image of await extractPageImages(page)) images.push(image)
    } finally {
      page.cleanup()
    }
  }
  if (context.isCancelled()) {
    return skip('no_text_layer', 'Stopped before OCR could read the scanned pages')
  }
  if (images.length === 0) {
    return skip(
      'no_text_layer',
      textLayer.length > 0
        ? 'The PDF has no embedded page images, so there is nothing for OCR to read'
        : 'The PDF has no selectable text and no embedded page images to OCR'
    )
  }

  try {
    const recognised = await ocr.recognizeImages(
      images,
      (info) => context.reportOcr?.(info),
      context.isCancelled
    )
    const cleaned = recognised.replace(/[ \t]+\n/g, '\n').trim()
    if (cleaned.length === 0) {
      return skip('no_text_layer', 'OCR finished but found no readable text on the scanned pages')
    }
    return {
      kind: 'text',
      text: textLayer.length > 0 ? `${textLayer}\n\n${cleaned}` : cleaned
    }
  } catch (error) {
    if (error instanceof OcrCancelledError || context.isCancelled()) {
      return skip('no_text_layer', 'OCR was cancelled before finishing this file')
    }
    if (error instanceof OcrUnavailableError) {
      return skip('no_text_layer', error.message)
    }
    return skip(
      'ocr_failed',
      `OCR could not read this PDF (${error instanceof Error ? error.message : String(error)})`
    )
  }
}

export function createPdfExtractor(ocr: OcrService): Extractor {
  return {
    id: 'pdf',
    extensions: ['pdf'],
    async extract(path, context: ExtractContext) {
      try {
        const guarded = await guardSize(path, MAX_BYTES)
        if (guarded) return guarded

        const data = new Uint8Array(await readWholeFile(path))
        const loadingTask = getDocument({
          data,
          useWorkerFetch: false,
          disableFontFace: true,
          cMapUrl: assetDir('cmaps'),
          cMapPacked: true,
          standardFontDataUrl: assetDir('standard_fonts')
        })
        let document: Awaited<typeof loadingTask.promise>
        try {
          document = await loadingTask.promise
        } catch (error) {
          const name = (error as { name?: string }).name
          if (name === 'PasswordException') {
            return skip('password_protected', 'The PDF is encrypted and asks for a password')
          }
          return skip('corrupt', `The PDF could not be opened (${failureMessage(error)})`)
        }

        try {
          const pages: string[] = []
          for (let number = 1; number <= document.numPages; number += 1) {
            if (context.isCancelled()) break
            const page = await document.getPage(number)
            try {
              const content = await page.getTextContent()
              pages.push(
                content.items
                  .map((item) => ('str' in item ? item.str : ''))
                  .join(' ')
                  .replace(/[ \t]+/g, ' ')
                  .trim()
              )
            } finally {
              page.cleanup()
            }
          }
          const text = pages.filter((page) => page.length > 0).join('\n\n').trim()
          if (text.length > 0 && !context.forceOcr) return { kind: 'text', text }
          return await ocrOutcome(document, text, ocr, context)
        } finally {
          await loadingTask.destroy()
        }
      } catch (error) {
        return fileErrorOutcome(error) ?? skip('read_error', failureMessage(error))
      }
    }
  }
}

/** Used by tests and tooling that run without OCR assets. */
export const pdfExtractor: Extractor = createPdfExtractor(new OcrService(null))
