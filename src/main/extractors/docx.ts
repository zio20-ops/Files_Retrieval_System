import mammoth from 'mammoth'
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

const MAX_BYTES = 100 * 1024 * 1024

export const docxExtractor: Extractor = {
  id: 'docx',
  extensions: ['docx'],
  async extract(path) {
    try {
      const guarded = await guardSize(path, MAX_BYTES)
      if (guarded) return guarded

      const head = await readHead(path, 8)
      if (isCompoundContainer(head)) {
        return skip('password_protected', 'The document is encrypted and asks for a password')
      }
      if (!isZipContainer(head)) return notAContainer('Word (.docx)')

      const result = await mammoth.extractRawText({ path })
      const text = result.value.trim()
      if (text.length === 0) return skip('empty_file', 'The document has no text')
      return { kind: 'text', text }
    } catch (error) {
      return fileErrorOutcome(error) ?? skip('corrupt', `Word could not read the file (${failureMessage(error)})`)
    }
  }
}
