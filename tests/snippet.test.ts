import { describe, expect, it } from 'vitest'
import { normalize } from '@main/search/normalize'
import { buildSnippet, findHits } from '@main/search/snippet'

function joined(parts: { text: string }[]): string {
  return parts.map((part) => part.text).join('')
}

describe('findHits', () => {
  it('maps a normalized match back to the raw offsets, keeping harakat', () => {
    const raw = 'اتفاقيةُ التعاونِ بينَ الشركاتِ'
    const hits = findHits(raw, [normalize('اتفاقية')])
    expect(hits).toHaveLength(1)
    expect(raw.slice(hits[0].start, hits[0].end)).toBe('اتفاقيةُ')
  })

  it('finds hamza and ta marbuta variants through normalization', () => {
    const raw = 'الإتّفاقيةُ تشملُ مسؤولياتِ الإدارةِ'
    const hits = findHits(raw, [normalize('الاتفاقية')])
    expect(hits).toHaveLength(1)
    expect(raw.slice(hits[0].start, hits[0].end)).toBe('الإتّفاقيةُ')
  })

  it('finds every occurrence of a needle', () => {
    const raw = 'report of the report about reports'
    const hits = findHits(raw, [normalize('report')])
    expect(hits.map((hit) => raw.slice(hit.start, hit.end))).toEqual([
      'report',
      'report',
      'report'
    ])
  })

  it('merges overlapping ranges coming from different needles', () => {
    const raw = 'annual report 2026'
    const hits = findHits(raw, [normalize('report'), normalize('annual report')])
    expect(hits).toHaveLength(1)
    expect(raw.slice(hits[0].start, hits[0].end)).toBe('annual report')
  })

  it('matches a prefix needle inside a longer word', () => {
    const raw = 'اتفاقية التعاون'
    const hits = findHits(raw, [normalize('اتفاق')])
    expect(raw.slice(hits[0].start, hits[0].end)).toBe('اتفاق')
  })

  it('returns nothing for empty input or no match', () => {
    expect(findHits('', ['x'])).toEqual([])
    expect(findHits('ملف', [normalize('ميزانية')])).toEqual([])
  })
})

describe('buildSnippet', () => {
  it('flags the matched span and keeps the original text around it', () => {
    const raw = 'الإتّفاقيةُ تشملُ مسؤولياتِ الإدارةِ والموظّفينَ'
    const hits = findHits(raw, [normalize('مسؤوليات')])
    const parts = buildSnippet(raw, hits, 12)
    expect(parts).not.toBeNull()
    expect(parts!.filter((part) => part.hit).map((part) => part.text)).toEqual(['مسؤولياتِ'])
    expect(joined(parts!)).toContain('الإدارةِ')
  })

  it('adds an ellipsis only when the window is clipped', () => {
    const long = 'a long paragraph '.repeat(20) + ' needle'
    const clipped = buildSnippet(long, findHits(long, [normalize('needle')]), 20)!
    expect(joined(clipped)).toContain('\u2026')

    const raw = 'short text here'
    const whole = buildSnippet(raw, findHits(raw, [normalize('text')]), 70)!
    expect(joined(whole)).not.toContain('\u2026')
  })

  it('falls back to the beginning of the text when nothing matched', () => {
    const raw = 'no match at all in this paragraph'
    const parts = buildSnippet(raw, [])!
    expect(parts.every((part) => !part.hit)).toBe(true)
    expect(joined(parts)).toContain('no match')
  })

  it('never starts mid-word when the window is clipped', () => {
    const raw = 'alpha beta gamma delta epsilon zeta needle tail'
    const parts = buildSnippet(raw, findHits(raw, [normalize('needle')]), 10)!
    const body = joined(parts).replaceAll('\u2026', '').trim()
    expect(raw.split(' ')).toContain(body.split(' ')[0])
  })

  it('returns null for blank text', () => {
    expect(buildSnippet('   \n ', [])).toBeNull()
  })
})
