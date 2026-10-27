import * as xlsxNamespace from 'xlsx'
import {
  failureMessage,
  fileErrorOutcome,
  guardSize,
  isCompoundContainer,
  isZipContainer,
  notAContainer,
  readHead,
  skip
} from './guards'
import type { Extractor } from './registry'

// The bundled main process and plain Node resolve this CJS module differently;
// one of the two shapes puts the API under `default`.
type XlsxApi = typeof xlsxNamespace
const XLSX: XlsxApi = ((xlsxNamespace as { default?: XlsxApi }).default ??
  xlsxNamespace) as XlsxApi

const MAX_BYTES = 100 * 1024 * 1024

export const spreadsheetExtractor: Extractor = {
  id: 'spreadsheet',
  extensions: ['xls', 'xlsx', 'xlsm'],
  async extract(path) {
    try {
      const guarded = await guardSize(path, MAX_BYTES)
      if (guarded) return guarded

      const head = await readHead(path, 8)
      if (isCompoundContainer(head)) {
        // Legacy .xls is a compound container by design; only .xlsx family uses zip.
        if (!path.toLowerCase().endsWith('.xls')) {
          return skip('password_protected', 'The workbook is encrypted and asks for a password')
        }
      } else if (!isZipContainer(head) && !path.toLowerCase().endsWith('.xls')) {
        return notAContainer('Excel (.xlsx)')
      }

      const workbook = XLSX.readFile(path, { cellNF: false, cellStyles: false })
      const parts: string[] = []
      for (const name of workbook.SheetNames) {
        const sheet = workbook.Sheets[name]
        if (!sheet) continue
        const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false })
        if (csv.trim().length > 0) parts.push(`${name}\n${csv}`)
      }
      const text = parts.join('\n\n').trim()
      if (text.length === 0) return skip('empty_file', 'The workbook has no cell text')
      return { kind: 'text', text }
    } catch (error) {
      return (
        fileErrorOutcome(error) ?? skip('corrupt', `Excel could not read the file (${failureMessage(error)})`)
      )
    }
  }
}
