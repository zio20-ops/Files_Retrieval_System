import type { OcrProgressInfo, SkipReasonCode } from '@shared/types'

export interface ExtractContext {
  isCancelled: () => boolean
  /** The user explicitly asked for this file to go through OCR again. */
  forceOcr?: boolean
  reportOcr?: (info: OcrProgressInfo) => void
}

export type ExtractOutcome =
  | { kind: 'text'; text: string }
  | { kind: 'skip'; reason: SkipReasonCode; message: string }

export interface Extractor {
  readonly id: string
  readonly extensions: readonly string[]
  extract(absolutePath: string, context: ExtractContext): Promise<ExtractOutcome>
}

/**
 * Adding a new document type later means writing one Extractor and calling
 * register(); the indexer, the search and the UI pick it up from here without
 * any other change.
 */
export class ExtractorRegistry {
  private readonly byExtension = new Map<string, Extractor>()

  register(extractor: Extractor): void {
    for (const extension of extractor.extensions) {
      this.byExtension.set(extension.toLowerCase(), extractor)
    }
  }

  forExtension(extension: string): Extractor | undefined {
    return this.byExtension.get(extension.toLowerCase())
  }

  get supportedExtensions(): string[] {
    return [...this.byExtension.keys()].sort()
  }
}
