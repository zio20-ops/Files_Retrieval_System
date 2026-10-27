import { normalize } from '../search/normalize'

export interface Chunk {
  textRaw: string
  textNorm: string
}

export interface ChunkOptions {
  /** Soft upper bound for one chunk, in characters. */
  maxChars?: number
  /** Hard cap on chunks per file, so one enormous document cannot fill the DB. */
  maxChunks?: number
}

const DEFAULT_MAX_CHARS = 3000
const DEFAULT_MAX_CHUNKS = 400

/** Splits text into chunks; one chunk becomes one snippet, so size is a search-quality tradeoff. */
export function chunkText(text: string, options: ChunkOptions = {}): { chunks: Chunk[]; truncated: boolean } {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS
  const maxChunks = options.maxChunks ?? DEFAULT_MAX_CHUNKS

  const collapsed = text.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').trim()
  if (collapsed.length === 0) return { chunks: [], truncated: false }

  const pieces = splitIntoPieces(collapsed, maxChars)

  const chunks: Chunk[] = []
  let truncated = false
  for (const piece of pieces) {
    if (chunks.length >= maxChunks) {
      truncated = true
      break
    }
    const textRaw = piece.trim()
    if (textRaw.length === 0) continue
    chunks.push({ textRaw, textNorm: normalize(textRaw) })
  }
  return { chunks, truncated }
}

function splitIntoPieces(text: string, maxChars: number): string[] {
  const pieces: string[] = []
  // Blank lines only: extracted PDF/Word text is often hard-wrapped mid-sentence.
  for (const paragraph of text.split(/\n{2,}/)) {
    if (paragraph.length === 0) continue
    if (paragraph.length <= maxChars) {
      pieces.push(paragraph)
      continue
    }
    pieces.push(...splitLongParagraph(paragraph, maxChars))
  }
  return pieces
}

function splitLongParagraph(paragraph: string, maxChars: number): string[] {
  const sentences = paragraph.match(/[^.!?۔؟]+[.!?۔؟]*\s*/g) ?? [paragraph]
  const pieces: string[] = []
  let buffer = ''
  for (const sentence of sentences) {
    if (sentence.length > maxChars) {
      if (buffer.length > 0) {
        pieces.push(buffer)
        buffer = ''
      }
      for (let i = 0; i < sentence.length; i += maxChars) {
        pieces.push(sentence.slice(i, i + maxChars))
      }
      continue
    }
    if (buffer.length + sentence.length > maxChars && buffer.length > 0) {
      pieces.push(buffer)
      buffer = sentence
    } else {
      buffer += sentence
    }
  }
  if (buffer.length > 0) pieces.push(buffer)
  return pieces
}
