import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { docExtractor } from '@main/extractors/doc'
import { docxExtractor } from '@main/extractors/docx'
import { pdfExtractor } from '@main/extractors/pdf'
import { spreadsheetExtractor } from '@main/extractors/spreadsheet'
import type { ExtractOutcome } from '@main/extractors/registry'
import { generateFixtures } from '../scripts/fixtures/generate.mjs'

const root = join(process.cwd(), '.tmp', 'tests', 'fixtures')
const neverCancelled = { isCancelled: () => false }

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

describe('docx extractor', () => {
  it('reads Arabic and English paragraphs from a real .docx', async () => {
    const text = textOf(await docxExtractor.extract(join(root, 'arabic-report.docx'), neverCancelled))
    expect(text).toContain('اتفاقيةُ التعاونِ بينَ الشركاتِ')
    expect(text).toContain('أسماءُ الموظفينَ: أحمد، إسلام، مؤمن، هبة')
  })

  it('reads English paragraphs', async () => {
    const text = textOf(await docxExtractor.extract(join(root, 'english-report.docx'), neverCancelled))
    expect(text).toContain('Quarterly sales report for the northern region')
  })

  it('reports a truncated .docx as corrupt without throwing', async () => {
    expect(skipOf(await docxExtractor.extract(join(root, 'corrupt.docx'), neverCancelled))).toBe('corrupt')
  })

  it('reports a non-zip .docx as corrupt', async () => {
    expect(skipOf(await docxExtractor.extract(join(root, 'mislabelled.docx'), neverCancelled))).toBe('corrupt')
  })

  it('reports an empty .docx as empty', async () => {
    expect(skipOf(await docxExtractor.extract(join(root, 'empty.docx'), neverCancelled))).toBe('empty_file')
  })
})

describe('doc extractor (Word 97)', () => {
  it('reads Arabic text from a genuine Word 97 .doc', async () => {
    const text = textOf(await docExtractor.extract(join(root, 'arabic-legacy.doc'), neverCancelled))
    expect(text).toContain('اتفاقيةُ التعاونِ بينَ الشركاتِ')
    expect(text).toContain('التقريرُ السنويُّ للميزانيةِ الكبرى')
  })

  it('reads English text from a genuine Word 97 .doc', async () => {
    const text = textOf(await docExtractor.extract(join(root, 'english-legacy.doc'), neverCancelled))
    expect(text).toContain('Quarterly sales report for the northern region')
  })

  it('reports an encrypted .doc as password protected', async () => {
    const outcome = await docExtractor.extract(join(root, 'encrypted-legacy.doc'), neverCancelled)
    expect(skipOf(outcome)).toBe('password_protected')
  })
})

describe('spreadsheet extractor', () => {
  it('reads Arabic and English cell text from .xlsx', async () => {
    const text = textOf(await spreadsheetExtractor.extract(join(root, 'workbook.xlsx'), neverCancelled))
    expect(text).toContain('اتفاقيةُ التعاونِ معَ الموردِ')
    expect(text).toContain('Quarterly renewal approved')
    expect(text).toContain('Sales')
  })

  it('reads legacy BIFF8 .xls', async () => {
    const text = textOf(
      await spreadsheetExtractor.extract(join(root, 'workbook-legacy.xls'), neverCancelled)
    )
    expect(text).toContain('الإتّفاقيةُ النهائيةُ للميزانيةِ')
  })

  it('reports a plain-text .xlsx as corrupt', async () => {
    expect(skipOf(await spreadsheetExtractor.extract(join(root, 'corrupt.xlsx'), neverCancelled))).toBe(
      'corrupt'
    )
  })
})

describe('pdf extractor', () => {
  it('reads the text layer of a real PDF', async () => {
    const text = textOf(await pdfExtractor.extract(join(root, 'report.pdf'), neverCancelled))
    expect(text).toContain('Quarterly sales report for the northern region')
    expect(text).toContain('Invoice 2026-114 is pending signature')
  })

  it('reports a scanned PDF as having no text layer', async () => {
    expect(skipOf(await pdfExtractor.extract(join(root, 'scanned.pdf'), neverCancelled))).toBe(
      'no_text_layer'
    )
  })

  it('reports an encrypted PDF as password protected', async () => {
    expect(skipOf(await pdfExtractor.extract(join(root, 'locked.pdf'), neverCancelled))).toBe(
      'password_protected'
    )
  })

  it('reports a broken PDF as corrupt', async () => {
    expect(skipOf(await pdfExtractor.extract(join(root, 'corrupt.pdf'), neverCancelled))).toBe('corrupt')
  })
})
