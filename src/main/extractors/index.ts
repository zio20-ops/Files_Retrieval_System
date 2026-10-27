import type { ExtractorRegistry } from './registry'
import type { OcrService } from '../ocr/ocrService'
import { docExtractor } from './doc'
import { docxExtractor } from './docx'
import { createPdfExtractor } from './pdf'
import { spreadsheetExtractor } from './spreadsheet'

export function registerBuiltinExtractors(registry: ExtractorRegistry, ocr: OcrService): void {
  registry.register(createPdfExtractor(ocr))
  registry.register(docxExtractor)
  registry.register(docExtractor)
  registry.register(spreadsheetExtractor)
}
