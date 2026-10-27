import { describe, expect, it } from 'vitest'
import { chunkText } from '@main/indexer/chunker'

describe('chunkText', () => {
  it('returns nothing for empty or whitespace-only text', () => {
    expect(chunkText('').chunks).toEqual([])
    expect(chunkText('   \n\n  ').chunks).toEqual([])
  })

  it('keeps each paragraph in its own chunk when it fits', () => {
    const { chunks } = chunkText('First paragraph.\n\nSecond paragraph.')
    expect(chunks.map((chunk) => chunk.textRaw)).toEqual([
      'First paragraph.',
      'Second paragraph.'
    ])
  })

  it('normalizes Windows line endings and trailing spaces', () => {
    const { chunks } = chunkText('Line one.  \r\nLine two.\r\n\r\nNext.')
    expect(chunks.map((chunk) => chunk.textRaw)).toEqual(['Line one.\nLine two.', 'Next.'])
  })

  it('splits an oversized paragraph at sentence boundaries', () => {
    const sentence = 'This is sentence number one. '
    const paragraph = sentence.repeat(400)
    const { chunks } = chunkText(paragraph, { maxChars: 500 })
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(chunk.textRaw.length).toBeLessThanOrEqual(520)
    }
    expect(chunks[0].textRaw.endsWith('.')).toBe(true)
  })

  it('hard-splits a single sentence longer than the chunk size', () => {
    const blob = 'a'.repeat(2500)
    const { chunks } = chunkText(blob, { maxChars: 1000 })
    expect(chunks.length).toBe(3)
    expect(chunks[0].textRaw.length).toBe(1000)
  })

  it('stores the Arabic-normalized twin of every chunk', () => {
    const { chunks } = chunkText('مِلْفَاتُ الشَّرِكَةِ')
    expect(chunks[0].textRaw).toBe('مِلْفَاتُ الشَّرِكَةِ')
    expect(chunks[0].textNorm).toBe('ملفات الشركه')
  })

  it('caps the chunk count and reports truncation', () => {
    const text = Array.from({ length: 10 }, (_, i) => `Paragraph ${i}.`).join('\n\n')
    const { chunks, truncated } = chunkText(text, { maxChunks: 4 })
    expect(chunks.length).toBe(4)
    expect(truncated).toBe(true)
  })

  it('does not flag truncation when everything fits', () => {
    const { truncated } = chunkText('One.\n\nTwo.')
    expect(truncated).toBe(false)
  })
})
