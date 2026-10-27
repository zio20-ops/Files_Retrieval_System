export interface ZipEntry {
  name: string
  data: Buffer
}

export function zipStore(entries: ZipEntry[]): Buffer
export function buildDocx(paragraphs: string[]): Buffer
export function buildDoc(text: string): Buffer
export function buildEncryptedDoc(): Buffer
export function buildPlainPdf(lines: string[]): Buffer
export function buildEncryptedPdf(lines: string[], userPassword: string): Buffer
export function buildScannedPdf(): Buffer
export function generateFixtures(root: string): string

export const ARABIC_PARAGRAPHS: string[]
export const ENGLISH_PARAGRAPHS: string[]
