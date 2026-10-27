import { useSyncExternalStore } from 'react'
import en from './locales/en.json'

/**
 * Every user-facing string goes through t(). Adding the Arabic locale later is
 * a matter of dropping an ar.json next to en.json and registering it in
 * `dictionaries` — no component changes.
 */
export type Dictionary = typeof en
export type TranslationKey = keyof Dictionary
export type Locale = 'en'

const dictionaries: Record<Locale, Dictionary> = { en }

let currentLocale: Locale = 'en'
const listeners = new Set<() => void>()

export function getLocale(): Locale {
  return currentLocale
}

export function setLocale(next: Locale): void {
  if (next === currentLocale) return
  currentLocale = next
  for (const listener of listeners) listener()
}

export function t(key: TranslationKey, vars?: Record<string, string | number>): string {
  let value: string = dictionaries[currentLocale][key]
  if (vars) {
    for (const [name, replacement] of Object.entries(vars)) {
      value = value.split(`{${name}}`).join(String(replacement))
    }
  }
  return isolate(value)
}

/**
 * The app shell is RTL, but during development the strings are English. Plain
 * LTR text inside an RTL paragraph reorders its trailing punctuation (a final
 * "." jumps to the visual start of the line). Wrapping every translated string
 * in a bidi isolate keeps the container's RTL alignment while the sentence
 * itself flows in its own direction. Once the Arabic locale lands, the same
 * isolation keeps Arabic sentences correct inside any mixed-content layout.
 */
const LTR_ISOLATE = String.fromCharCode(0x2066)
const RTL_ISOLATE = String.fromCharCode(0x2067)
const POP_ISOLATE = String.fromCharCode(0x2069)

function firstStrongDirection(value: string): 'ltr' | 'rtl' | null {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (isStrongRtl(code)) return 'rtl'
    if (isStrongLtr(code)) return 'ltr'
  }
  return null
}

function isStrongRtl(code: number): boolean {
  return (
    (code >= 0x0590 && code <= 0x05ff) || // Hebrew
    (code >= 0x0600 && code <= 0x06ff) || // Arabic
    (code >= 0x0700 && code <= 0x074f) || // Syriac
    (code >= 0x0750 && code <= 0x077f) || // Arabic supplement
    (code >= 0x08a0 && code <= 0x08ff) || // Arabic extended-A
    (code >= 0xfb50 && code <= 0xfdff) || // Arabic presentation forms A
    (code >= 0xfe70 && code <= 0xfeff) // Arabic presentation forms B
  )
}

function isStrongLtr(code: number): boolean {
  return (
    (code >= 0x41 && code <= 0x5a) ||
    (code >= 0x61 && code <= 0x7a) ||
    (code >= 0xc0 && code <= 0x024f) ||
    (code >= 0x0370 && code <= 0x052f) ||
    (code >= 0x1e00 && code <= 0x1eff)
  )
}

function isolate(value: string): string {
  const direction = firstStrongDirection(value)
  if (direction === 'rtl') return `${RTL_ISOLATE}${value}${POP_ISOLATE}`
  if (direction === 'ltr') return `${LTR_ISOLATE}${value}${POP_ISOLATE}`
  return value
}

/** For strings that come from data (log messages, errors) rather than the dictionary. */
export function isolateText(value: string): string {
  return isolate(value)
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useLocale(): Locale {
  return useSyncExternalStore(subscribe, getLocale, getLocale)
}

/** Returns t and re-renders the caller when the locale changes. */
export function useT(): typeof t {
  useLocale()
  return t
}
