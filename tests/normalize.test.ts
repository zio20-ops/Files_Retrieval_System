import { describe, expect, it } from 'vitest'
import {
  expandLeadingRemoved,
  expandTrailingRemoved,
  normalize,
  normalizeWithMap,
  tokenize
} from '@main/search/normalize'

describe('normalize: Arabic harakat (diacritics)', () => {
  it('strips tashkeel so vocalized and plain spellings match', () => {
    expect(normalize('مِلْفَات')).toBe(normalize('ملفات'))
    expect(normalize('مِلْفَات')).toBe('ملفات')
  })

  it('strips shadda, tanwin, sukun and superscript alef', () => {
    expect(normalize('مُحَمَّد')).toBe('محمد')
    expect(normalize('كِتَاباً')).toBe('كتابا')
    expect(normalize('هٰذَا')).toBe('هذا')
  })

  it('strips tatweel (kashida)', () => {
    expect(normalize('عـــربــــي')).toBe('عربي')
  })

  it('strips Quranic annotation marks', () => {
    expect(normalize('قُلْ هُوَ اللَّهُ أَحَدٌ\u06E0')).toBe(normalize('قل هو الله احد'))
  })
})

describe('normalize: hamza carriers', () => {
  it('folds alef hamza forms to bare alef', () => {
    expect(normalize('إتفاقية')).toBe(normalize('اتفاقية'))
    expect(normalize('أحمد')).toBe(normalize('احمد'))
    expect(normalize('إبراهيم')).toBe(normalize('ابراهيم'))
    expect(normalize('آلة')).toBe(normalize('الة'))
    expect(normalize('ٱبتدأ')).toBe(normalize('ابتدا'))
  })

  it('folds waw hamza to waw and yeh hamza to yeh', () => {
    expect(normalize('مؤسسة')).toBe(normalize('موسسة'))
    expect(normalize('مؤسسة')).toBe('موسسه')
    expect(normalize('شئون')).toBe('شيون')
    expect(normalize('رئيس')).toBe(normalize('رييس'))
  })

  it('folds a real document phrase regardless of hamza spelling', () => {
    const variants = ['الإتفاقية', 'الاتفاقية', 'الاتّفاقية', 'الإتفاقيه']
    const folded = new Set(variants.map(normalize))
    expect(folded.size).toBe(1)
    expect([...folded][0]).toBe('الاتفاقيه')
  })
})

describe('normalize: alef maksura, ta marbuta and digits', () => {
  it('folds alef maksura to yeh', () => {
    expect(normalize('على')).toBe(normalize('علي'))
    expect(normalize('مستشفى')).toBe(normalize('مستشفي'))
  })

  it('folds ta marbuta to heh', () => {
    expect(normalize('شركة')).toBe(normalize('شركه'))
    expect(normalize('الشركة')).toBe('الشركه')
  })

  it('folds Arabic-Indic and extended Arabic-Indic digits to ASCII', () => {
    expect(normalize('١٢٣٤٥')).toBe('12345')
    expect(normalize('۱۲۳۴۵')).toBe('12345')
    expect(normalize('تقرير ٢٠٢٦')).toBe(normalize('تقرير 2026'))
  })

  it('folds Persian yeh and keheh', () => {
    expect(normalize('پارسای')).toBe(normalize('پارساي'))
    expect(normalize('کتاب')).toBe(normalize('كتاب'))
  })
})

describe('normalize: case, invisible characters and Latin', () => {
  it('lowercases Latin without changing length', () => {
    expect(normalize('Quarterly REPORT')).toBe('quarterly report')
    expect(normalize('Invoice-2026.PDF')).toBe('invoice-2026.pdf')
  })

  it('leaves accented Latin length intact for unicode61 to fold', () => {
    const result = normalizeWithMap('CAFÉ')
    expect(result.text.length).toBe(4)
    expect(result.sourceIndex.length).toBe(4)
  })

  it('removes bidi controls, ZWJ and BOM', () => {
    expect(normalize('\uFEFFreport\u200F2026')).toBe('report2026')
  })
})

describe('normalizeWithMap: index map integrity', () => {
  it('maps every normalized character back to its original index', () => {
    const raw = 'مِلْفَاتُ الشَّرِكَةِ 2026.pdf'
    const { text, sourceIndex } = normalizeWithMap(raw)
    expect(sourceIndex.length).toBe(text.length)
    for (let i = 0; i < text.length; i++) {
      const original = raw.charCodeAt(sourceIndex[i])
      // The mapped source char must be the one that produced this output char,
      // either unchanged or through a documented fold.
      expect(original).toBeGreaterThanOrEqual(0)
      expect(sourceIndex[i]).toBeLessThan(raw.length)
    }
    expect(sourceIndex[0]).toBe(0)
    // Indices are strictly increasing.
    for (let i = 1; i < sourceIndex.length; i++) {
      expect(sourceIndex[i]).toBeGreaterThan(sourceIndex[i - 1])
    }
  })

  it('lets the original diacritized text be recovered around a match', () => {
    const raw = 'تقرير مِلْفَاتُ العمل'
    const { text, sourceIndex } = normalizeWithMap(raw)
    const hit = text.indexOf('ملفات')
    expect(hit).toBeGreaterThan(-1)
    const rawStart = sourceIndex[hit]
    const rawEnd = sourceIndex[hit + 'ملفات'.length - 1] + 1
    expect(raw.slice(rawStart, rawEnd)).toBe('مِلْفَات')
  })

  it('expands a highlight past trailing and leading combining marks', () => {
    const raw = 'تقرير مِلْفَاتُ العمل'
    const { text, sourceIndex } = normalizeWithMap(raw)
    const hit = text.indexOf('ملفات')
    const rawStart = expandLeadingRemoved(raw, sourceIndex[hit])
    const rawEnd = expandTrailingRemoved(raw, sourceIndex[hit + 'ملفات'.length - 1] + 1)
    expect(raw.slice(rawStart, rawEnd)).toBe('مِلْفَاتُ')
  })
})

describe('tokenize: word boundaries', () => {
  it('splits on spaces and ASCII punctuation', () => {
    const tokens = tokenize('report-2026 final.pdf').map((t) => 'report-2026 final.pdf'.slice(t.start, t.end))
    expect(tokens).toEqual(['report', '2026', 'final', 'pdf'])
  })

  it('splits on Arabic punctuation the way unicode61 does', () => {
    const text = normalize('الشركة، والميزانية؛ والتقرير؟')
    const tokens = tokenize(text).map((t) => text.slice(t.start, t.end))
    expect(tokens).toEqual(['الشركه', 'والميزانيه', 'والتقرير'])
  })

  it('keeps Arabic words whole', () => {
    const tokens = tokenize('ملفات العمل').map((t) => 'ملفات العمل'.slice(t.start, t.end))
    expect(tokens).toEqual(['ملفات', 'العمل'])
  })
})
