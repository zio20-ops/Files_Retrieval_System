import { existsSync } from 'node:fs'
import { join } from 'node:path'

export const OCR_LANGUAGES = 'ara+eng'

export interface OcrAssets {
  /** Directory holding ara.traineddata and eng.traineddata. */
  tessdata: string
  /** Bundled tesseract.js worker script; null means "use the node_modules copy". */
  workerPath: string | null
  /** Bundled tesseract.js-core wasm directory; null means "use the node_modules copy". */
  corePath: string | null
}

function appRoot(): string {
  return process.cwd()
}

function resourcesRoot(): string {
  return process.resourcesPath ?? ''
}

function hasTraineddata(dir: string): boolean {
  return existsSync(join(dir, 'ara.traineddata')) && existsSync(join(dir, 'eng.traineddata'))
}

/**
 * OCR assets ship beside the app (resources/ocr in dev, process.resourcesPath/ocr
 * once packaged), so the installer can carry them without code changes: only
 * this lookup decides where Tesseract reads its language and wasm files from.
 */
export function resolveOcrAssets(): OcrAssets | null {
  const candidates = [join(resourcesRoot(), 'ocr'), join(appRoot(), 'resources', 'ocr')]
  for (const root of candidates) {
    const tessdata = join(root, 'tessdata')
    if (!hasTraineddata(tessdata)) continue
    const bundledWorker = join(root, 'tesseract.js', 'worker.min.js')
    const bundledCore = join(root, 'tesseract.js', 'core')
    return {
      tessdata,
      workerPath: existsSync(bundledWorker) ? bundledWorker : null,
      corePath: existsSync(bundledCore) ? bundledCore : null
    }
  }
  return null
}
