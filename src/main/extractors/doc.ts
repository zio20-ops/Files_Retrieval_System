import { readFileSync } from 'node:fs'
import CFB from 'cfb'
import WordExtractor from 'word-extractor'
import {
  failureMessage,
  fileErrorOutcome,
  guardSize,
  isCompoundContainer,
  readHead,
  skip
} from './guards'
import type { Extractor } from './registry'

const MAX_BYTES = 100 * 1024 * 1024
const WORD_MAGIC = 0xa5ec
const FIB_ENCRYPTED_FLAG = 0x0100

const reader = new WordExtractor()

export const docExtractor: Extractor = {
  id: 'doc',
  extensions: ['doc'],
  async extract(path) {
    try {
      const guarded = await guardSize(path, MAX_BYTES)
      if (guarded) return guarded

      const head = await readHead(path, 8)
      if (!isCompoundContainer(head)) {
        return skip('corrupt', 'The file is not a valid Word 97 (.doc) container')
      }
      if (isEncrypted(path)) {
        return skip('password_protected', 'The document is encrypted and asks for a password')
      }

      const document = await reader.extract(path)
      const text = document.getBody().trim()
      if (text.length === 0) return skip('empty_file', 'The document has no text')
      return { kind: 'text', text }
    } catch (error) {
      return fileErrorOutcome(error) ?? skip('corrupt', `Word could not read the file (${failureMessage(error)})`)
    }
  }
}

/** Word 97 stores the encryption flag in the FIB; an encrypted file has no readable WordDocument stream. */
function isEncrypted(path: string): boolean {
  let container: ReturnType<typeof CFB.read>
  try {
    container = CFB.read(readFileSync(path), { type: 'buffer' })
  } catch {
    return false
  }
  const entry = CFB.find(container, '/WordDocument')
  const content = entry?.content
  if (!content || !(content instanceof Uint8Array) || content.length < 0x0c) return true
  const magic = content[0] | (content[1] << 8)
  const flags = content[0x0a] | (content[0x0b] << 8)
  return magic !== WORD_MAGIC || (flags & FIB_ENCRYPTED_FLAG) !== 0
}
