import { createWorker, type Worker } from 'tesseract.js'
import { OCR_LANGUAGES, type OcrAssets } from './assets'
import type { OcrProgressInfo } from '@shared/types'

export class OcrUnavailableError extends Error {
  constructor() {
    super('OCR language data (ara+eng) is not installed on this machine')
  }
}

export class OcrCancelledError extends Error {
  constructor() {
    super('OCR was cancelled before it finished')
  }
}

export class OcrFailedError extends Error {}

/**
 * Wraps Tesseract (ara+eng). The engine runs in its own child process, so a
 * safe cancel is just terminating that process: nothing on disk and nothing
 * in the index depends on it surviving.
 */
export class OcrService {
  private worker: Worker | null = null
  private starting: Promise<Worker> | null = null

  constructor(private readonly assets: OcrAssets | null) {}

  get available(): boolean {
    return this.assets !== null
  }

  get languages(): string {
    return OCR_LANGUAGES
  }

  get tessdataPath(): string | null {
    return this.assets?.tessdata ?? null
  }

  async recognizeImages(
    images: Buffer[],
    onPage: (info: OcrProgressInfo) => void,
    isCancelled: () => boolean
  ): Promise<string> {
    if (!this.assets) throw new OcrUnavailableError()
    if (isCancelled()) throw new OcrCancelledError()
    const worker = await this.ensureWorker()
    const parts: string[] = []

    for (let i = 0; i < images.length; i += 1) {
      // Cancellation is cooperative: the page being read finishes (a few
      // seconds at most), then the loop stops. Killing the engine thread
      // mid-job would leave its promise unsettled and hang the run.
      if (isCancelled()) throw new OcrCancelledError()
      onPage({ page: i + 1, pages: images.length })
      try {
        const result = await worker.recognize(images[i])
        parts.push(result.data.text ?? '')
      } catch (error) {
        if (isCancelled()) throw new OcrCancelledError()
        throw new OcrFailedError(error instanceof Error ? error.message : String(error))
      }
    }
    return parts.join('\n').trim()
  }

  async dispose(): Promise<void> {
    const worker = this.worker
    this.worker = null
    this.starting = null
    if (worker) await worker.terminate().catch(() => undefined)
  }

  private ensureWorker(): Promise<Worker> {
    if (this.worker) return Promise.resolve(this.worker)
    if (!this.starting) {
      this.starting = this.create().then(
        (worker) => {
          this.worker = worker
          this.starting = null
          return worker
        },
        (error) => {
          this.starting = null
          throw new OcrFailedError(error instanceof Error ? error.message : String(error))
        }
      )
    }
    return this.starting
  }

  private create(): Promise<Worker> {
    const assets = this.assets
    if (!assets) return Promise.reject(new OcrUnavailableError())
    // tesseract.js spreads options over its defaults, so an explicit
    // `undefined` would wipe the bundled worker/core paths.
    const options: Record<string, unknown> = {
      langPath: assets.tessdata,
      gzip: false,
      logger: () => undefined
    }
    if (assets.workerPath) options.workerPath = assets.workerPath
    if (assets.corePath) options.corePath = assets.corePath
    return createWorker(OCR_LANGUAGES, 1, options as Parameters<typeof createWorker>[2])
  }
}
