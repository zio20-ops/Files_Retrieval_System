/**
 * Arabic-aware text normalization applied identically to indexed text and to
 * user queries, so that spelling variants collapse to one searchable form.
 *
 * SQLite's `unicode61` tokenizer does not fold Arabic harakat, hamza carriers,
 * alef maksura or ta marbuta, so a query for "الملفات" would miss "المِلْفَات"
 * and "الاتفاقية" would miss "الإتفاقية" without this step.
 *
 * Every transform here is strictly one-input-char to at-most-one-output-char so
 * that `normalizeWithMap` can return an exact index map back into the original
 * string. Snippets are rendered from the original text, which keeps diacritics
 * and hamza forms visible to the user even though they are not searchable.
 */

export interface NormalizedText {
  text: string
  /** sourceIndex[i] is the index in the original string that produced text[i]. */
  sourceIndex: Int32Array
}

/** Combining marks and invisible format characters that carry no search value. */
const REMOVED_RANGES: readonly (readonly [number, number])[] = [
  [0x0610, 0x061a], // Arabic Quranic signs
  [0x064b, 0x065f], // harakat, tanwin, hamza above/below, madda, subscript marks
  [0x0670, 0x0670], // superscript alef
  [0x06d6, 0x06ed], // Quranic annotation signs
  [0x0640, 0x0640], // tatweel (kashida)
  [0x061c, 0x061c], // Arabic letter mark
  [0x200b, 0x200f], // zero width space/joiners and LRM/RLM
  [0x202a, 0x202e], // bidi embedding controls
  [0x2060, 0x2064], // word joiner, invisible operators
  [0xfeff, 0xfeff] // BOM / zero width no-break space
]

/** Spelling variants folded to a single canonical character. */
const FOLDED: ReadonlyMap<number, number> = new Map<number, number>([
  // alef with hamza / madda / wasla -> bare alef
  [0x0622, 0x0627],
  [0x0623, 0x0627],
  [0x0625, 0x0627],
  [0x0671, 0x0627],
  [0x0672, 0x0627],
  [0x0673, 0x0627],
  // waw and yeh hamza carriers -> their base letter
  [0x0624, 0x0648],
  [0x0626, 0x064a],
  // alef maksura -> yeh
  [0x0649, 0x064a],
  // ta marbuta -> heh
  [0x0629, 0x0647],
  [0x06c0, 0x0647],
  // Persian/Urdu letters to their Arabic equivalents
  [0x06cc, 0x064a],
  [0x06a9, 0x0643],
  // Arabic-Indic digits -> ASCII digits
  ...Array.from({ length: 10 }, (_, i): [number, number] => [0x0660 + i, 0x30 + i]),
  ...Array.from({ length: 10 }, (_, i): [number, number] => [0x06f0 + i, 0x30 + i])
])

function isRemoved(code: number): boolean {
  for (const [low, high] of REMOVED_RANGES) {
    if (code >= low && code <= high) return true
  }
  return false
}

/**
 * Case folds a single character without changing string length. Characters whose
 * lowercase form expands (for example U+0130) are left alone so the index map
 * stays one-to-one; `unicode61` folds them on its side either way.
 *
 * Only scripts that actually have case are probed. Arabic has no letter case, so
 * skipping it keeps indexing of large Arabic documents cheap.
 */
function foldChar(code: number): number {
  const folded = FOLDED.get(code)
  if (folded !== undefined) return folded
  if (code >= 0x41 && code <= 0x5a) return code + 0x20
  if (code < 0x80) return code
  const hasCase =
    (code >= 0xc0 && code <= 0x24f) || // Latin extended, Greek, Cyrillic
    (code >= 0x370 && code <= 0x52f) || // Greek and Cyrillic supplements
    (code >= 0x1e00 && code <= 0x1eff) // Latin extended additional
  if (!hasCase) return code
  const lower = String.fromCharCode(code).toLowerCase()
  return lower.length === 1 ? lower.charCodeAt(0) : code
}

export function normalizeWithMap(input: string): NormalizedText {
  const out: string[] = []
  const sourceIndex = new Int32Array(input.length)
  let written = 0
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i)
    if (isRemoved(code)) continue
    out.push(String.fromCharCode(foldChar(code)))
    sourceIndex[written++] = i
  }
  return { text: out.join(''), sourceIndex: sourceIndex.subarray(0, written) }
}

export function normalize(input: string): string {
  return normalizeWithMap(input).text
}

/**
 * Extends an exclusive end offset in the original string past any combining
 * marks that normalize() removed, so a highlight covering "مِلْفَات" also covers
 * the trailing damma in "مِلْفَاتُ" instead of cutting through the word.
 */
export function expandTrailingRemoved(raw: string, end: number): number {
  let next = end
  while (next < raw.length && isRemoved(raw.charCodeAt(next))) next++
  return next
}

/**
 * Extends an inclusive start offset in the original string backwards past
 * combining marks, for the same reason as expandTrailingRemoved.
 */
export function expandLeadingRemoved(raw: string, start: number): number {
  let previous = start
  while (previous > 0 && isRemoved(raw.charCodeAt(previous - 1))) previous--
  return previous
}

/**
 * Runs of letters/digits, matching what `unicode61` treats as token characters.
 * Used by the snippet builder and by tests.
 */
export function tokenize(text: string): { start: number; end: number }[] {
  const tokens: { start: number; end: number }[] = []
  let start = -1
  for (let i = 0; i < text.length; i++) {
    if (isTokenChar(text.charCodeAt(i))) {
      if (start === -1) start = i
    } else if (start !== -1) {
      tokens.push({ start, end: i })
      start = -1
    }
  }
  if (start !== -1) tokens.push({ start, end: text.length })
  return tokens
}

/**
 * Punctuation inside scripts that are otherwise treated as letters. `unicode61`
 * splits on these, so the snippet tokenizer must too or the two disagree about
 * where a word ends.
 */
const SCRIPT_PUNCTUATION: ReadonlySet<number> = new Set([
  0x058a, // Armenian hyphen
  0x05c3, // Hebrew punctuation
  0x060c, // Arabic comma
  0x060d, // Arabic date separator
  0x061b, // Arabic semicolon
  0x061f, // Arabic question mark
  0x066a, 0x066b, 0x066c, 0x066d, // Arabic percent / decimal / thousands / star
  0x06d4, // Arabic full stop
  0x0700, 0x0701, 0x0702, 0x0703, // Syriac punctuation
  0x07f7, 0x07f8, 0x07f9, // N'Ko punctuation
  0x0964, 0x0965, // Devanagari danda
  0x3001, 0x3002, // CJK comma / full stop
  0xff0c, 0xff0e, 0xff1f, 0xff01 // fullwidth comma / stop / question / bang
])

export function isTokenChar(code: number): boolean {
  if (code === 0x5f) return true // _
  if (code >= 0x30 && code <= 0x39) return true // 0-9
  if (code >= 0x41 && code <= 0x5a) return true // A-Z
  if (code >= 0x61 && code <= 0x7a) return true // a-z
  if (code < 0x80) return false
  if (SCRIPT_PUNCTUATION.has(code)) return false
  return !isRemoved(code)
}
