import { mkdirSync, writeFileSync } from 'node:fs'
import { createHash, randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as XLSX from 'xlsx'
import CFB from 'cfb'

/* ------------------------------------------------------------------ zip */

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buffer) {
  let crc = -1
  for (let i = 0; i < buffer.length; i += 1) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buffer[i]) & 0xff]
  }
  return (crc ^ -1) >>> 0
}

/** Store-only zip writer: fixtures need a valid container, not small files. */
export function zipStore(entries) {
  const locals = []
  const centrals = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const crc = crc32(entry.data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6)
    local.writeUInt16LE(0, 8)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(entry.data.length, 18)
    local.writeUInt32LE(entry.data.length, 22)
    local.writeUInt16LE(name.length, 26)
    locals.push(local, name, entry.data)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(entry.data.length, 20)
    central.writeUInt32LE(entry.data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, name)
    offset += local.length + name.length + entry.data.length
  }
  const centralBuffer = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralBuffer.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, centralBuffer, end])
}

/* ----------------------------------------------------------------- docx */

function escapeXml(text) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

export function buildDocx(paragraphs) {
  const body = paragraphs
    .map((text) => `<w:p><w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`)
    .join('')
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`
  return zipStore([
    { name: '[Content_Types].xml', data: Buffer.from(contentTypes, 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(rels, 'utf8') },
    { name: 'word/document.xml', data: Buffer.from(document, 'utf8') }
  ])
}

/* ------------------------------------------------------------------ pdf */

function pdfString(text) {
  return `(${text.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)')})`
}

function pdfContentStream(lines) {
  const ops = ['BT', '/F1 12 Tf', '72 720 Td', '16 TL']
  for (const line of lines) {
    ops.push(`${pdfString(line)} Tj`, 'T*')
  }
  ops.push('ET')
  return ops.join('\n')
}

const PDF_PADDING = Buffer.from(
  '28BF4E5E4E758A4164004E56FFFA01082E2E00B6D0683E854F584A45205F504E',
  'hex'
)

function md5(...parts) {
  const hash = createHash('md5')
  for (const part of parts) hash.update(part)
  return hash.digest()
}

/** RC4 by hand: OpenSSL 3 disables the cipher unless the legacy provider is loaded. */
function rc4(key, data) {
  const state = new Uint8Array(256)
  for (let i = 0; i < 256; i += 1) state[i] = i
  let j = 0
  for (let i = 0; i < 256; i += 1) {
    j = (j + state[i] + key[i % key.length]) & 0xff
    ;[state[i], state[j]] = [state[j], state[i]]
  }
  const out = Buffer.alloc(data.length)
  let x = 0
  let y = 0
  for (let n = 0; n < data.length; n += 1) {
    x = (x + 1) & 0xff
    y = (y + state[x]) & 0xff
    ;[state[x], state[y]] = [state[y], state[x]]
    out[n] = data[n] ^ state[(state[x] + state[y]) & 0xff]
  }
  return out
}

function padPassword(password) {
  const source = Buffer.from(password, 'latin1')
  return Buffer.concat([source, PDF_PADDING]).subarray(0, 32)
}

/**
 * Emits a genuinely encrypted PDF (standard security handler, RC4 40-bit) so
 * the password path is exercised against a real file, not a mock.
 */
export function buildEncryptedPdf(lines, userPassword) {
  const fileId = randomBytes(16)
  const ownerHash = md5(padPassword('owner')).subarray(0, 5)
  const oValue = rc4(ownerHash, padPassword(userPassword))
  const permissions = Buffer.alloc(4)
  permissions.writeInt32LE(-44, 0)
  const key = md5(padPassword(userPassword), oValue, permissions, fileId).subarray(0, 5)
  const uValue = rc4(key, PDF_PADDING)

  const content = Buffer.from(pdfContentStream(lines), 'latin1')
  const objectKey = md5(
    key,
    Buffer.from([4 & 0xff, (4 >> 8) & 0xff, (4 >> 16) & 0xff, 0, 0])
  ).subarray(0, 10)
  const encryptedContent = rc4(objectKey, content)

  const objects = []
  objects[1] = Buffer.from('<< /Type /Catalog /Pages 2 0 R >>')
  objects[2] = Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>')
  objects[3] = Buffer.from(
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>'
  )
  objects[4] = Buffer.concat([
    Buffer.from(`<< /Length ${encryptedContent.length} >>\nstream\n`),
    encryptedContent,
    Buffer.from('\nendstream')
  ])
  objects[5] = Buffer.from(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'
  )
  objects[6] = Buffer.concat([
    Buffer.from(
      `<< /Filter /Standard /V 1 /R 2 /Length 40 /P -44 /O <${oValue.toString('hex')}> /U <${uValue.toString(
        'hex'
      )}> >>`
    )
  ])

  return assemblePdf(objects, fileId, '6 0 R')
}

export function buildPlainPdf(lines) {
  const content = Buffer.from(pdfContentStream(lines), 'latin1')
  const fileId = randomBytes(16)
  const objects = []
  objects[1] = Buffer.from('<< /Type /Catalog /Pages 2 0 R >>')
  objects[2] = Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>')
  objects[3] = Buffer.from(
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>'
  )
  objects[4] = Buffer.concat([
    Buffer.from(`<< /Length ${content.length} >>\nstream\n`),
    content,
    Buffer.from('\nendstream')
  ])
  objects[5] = Buffer.from(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'
  )
  return assemblePdf(objects, fileId, null)
}

/** A page that draws shapes only: getTextContent() finds nothing to index. */
export function buildScannedPdf() {
  const content = Buffer.from('0.2 0.4 0.6 rg\n72 720 200 120 re\nf\n', 'latin1')
  const fileId = randomBytes(16)
  const objects = []
  objects[1] = Buffer.from('<< /Type /Catalog /Pages 2 0 R >>')
  objects[2] = Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>')
  objects[3] = Buffer.from(
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>'
  )
  objects[4] = Buffer.concat([
    Buffer.from(`<< /Length ${content.length} >>\nstream\n`),
    content,
    Buffer.from('\nendstream')
  ])
  return assemblePdf(objects, fileId, null)
}

function assemblePdf(objects, fileId, encryptRef) {
  const chunks = [Buffer.from('%PDF-1.4\n')]
  const offsets = []
  for (let number = 1; number < objects.length; number += 1) {
    const body = objects[number]
    if (!body) continue
    offsets[number] = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
    chunks.push(Buffer.from(`${number} 0 obj\n`), body, Buffer.from('\nendobj\n'))
  }
  const xrefOffset = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const count = objects.length
  const xref = [`xref\n0 ${count}\n`, '0000000000 65535 f \n']
  for (let number = 1; number < count; number += 1) {
    xref.push(`${String(offsets[number]).padStart(10, '0')} 00000 n \n`)
  }
  chunks.push(Buffer.from(xref.join('')))
  chunks.push(
    Buffer.from(
      `trailer\n<< /Size ${count} /Root 1 0 R${
        encryptRef ? ` /Encrypt ${encryptRef}` : ''
      } /ID [<${fileId.toString('hex')}> <${fileId.toString('hex')}>] >>\nstartxref\n${xrefOffset}\n%%EOF\n`
    )
  )
  return Buffer.concat(chunks)
}

/* ------------------------------------------------------------------ doc */

function writeDocBuffer(text, { encrypted = false } = {}) {
  const chars = [...text]
  const textBytes = Buffer.from(text, 'utf16le')
  const wordDocument = Buffer.alloc(0x400 + textBytes.length)
  wordDocument.writeUInt16LE(0xa5ec, 0x00)
  wordDocument.writeUInt16LE(0x00c1, 0x02)
  const flags = encrypted ? 0x0100 : 0x0000
  wordDocument.writeUInt16LE(flags, 0x0a)
  const fcMin = 0x400
  wordDocument.writeUInt32LE(fcMin, 0x18)
  wordDocument.writeUInt32LE(fcMin + textBytes.length, 0x1c)
  wordDocument.writeUInt32LE(chars.length, 0x4c) // ccpText
  textBytes.copy(wordDocument, fcMin)

  // One piece table entry covering the whole document, uncompressed UTF-16LE.
  const plcSize = 2 * 4 + 1 * 8
  const clx = Buffer.alloc(5 + plcSize)
  clx.writeUInt8(0x02, 0)
  clx.writeUInt32LE(plcSize, 1)
  clx.writeUInt32LE(0, 5) // CP start
  clx.writeUInt32LE(chars.length, 9) // CP end
  clx.writeUInt16LE(0, 13)
  clx.writeUInt32LE(fcMin, 15)
  clx.writeUInt16LE(0, 19)

  const table = Buffer.alloc(0x200 + clx.length)
  const fcClx = 0x100
  clx.copy(table, fcClx)

  wordDocument.writeUInt32LE(fcClx, 0x1a2)
  wordDocument.writeUInt32LE(clx.length, 0x1a6)

  const cfb = CFB.utils.cfb_new()
  CFB.utils.cfb_add(cfb, '/WordDocument', wordDocument)
  CFB.utils.cfb_add(cfb, '/0Table', table)
  return Buffer.from(CFB.write(cfb, { type: 'buffer' }))
}

export function buildDoc(text) {
  return writeDocBuffer(text)
}

export function buildEncryptedDoc() {
  return writeDocBuffer('hidden', { encrypted: true })
}

/* ------------------------------------------------------------- fixtures */

export const ARABIC_PARAGRAPHS = [
  'اتفاقيةُ التعاونِ بينَ الشركاتِ',
  'الإتّفاقيةُ تشملُ مسؤولياتِ الإدارةِ والموظّفينَ',
  'أسماءُ الموظفينَ: أحمد، إسلام، مؤمن، هبة',
  'التقريرُ السنويُّ للميزانيةِ الكبرى',
  'ملاحظاتٌ على مشروعِ التطويرِ'
]

export const ENGLISH_PARAGRAPHS = [
  'Quarterly sales report for the northern region',
  'The budget committee approved the renewal terms',
  'Invoice 2026-114 is pending signature'
]

export function generateFixtures(root) {
  mkdirSync(root, { recursive: true })
  const write = (name, data) => writeFileSync(join(root, name), data)

  write('arabic-report.docx', buildDocx(ARABIC_PARAGRAPHS))
  write('english-report.docx', buildDocx(ENGLISH_PARAGRAPHS))
  write('arabic-legacy.doc', buildDoc(ARABIC_PARAGRAPHS.join('\r\n')))
  write('english-legacy.doc', buildDoc(ENGLISH_PARAGRAPHS.join('\r\n')))
  write('encrypted-legacy.doc', buildEncryptedDoc())

  const workbook = XLSX.utils.book_new()
  const rows = [
    ['Region', 'Notes'],
    ['Cairo', 'اتفاقيةُ التعاونِ معَ الموردِ'],
    ['Alexandria', 'الإتّفاقيةُ النهائيةُ للميزانيةِ'],
    ['Giza', 'Quarterly renewal approved']
  ]
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Sales')
  write('workbook.xlsx', XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }))
  try {
    write('workbook-legacy.xls', XLSX.write(workbook, { type: 'buffer', bookType: 'xls' }))
  } catch {
    // BIFF8 writing is optional; the .xls read path is still covered by the doc fixtures.
  }

  write('report.pdf', buildPlainPdf(ENGLISH_PARAGRAPHS))
  write('scanned.pdf', buildScannedPdf())
  write('locked.pdf', buildEncryptedPdf(ENGLISH_PARAGRAPHS, 'secret123'))

  write('corrupt.pdf', Buffer.concat([Buffer.from('%PDF-1.4\n'), randomBytes(64)]))
  const goodDocx = buildDocx(ENGLISH_PARAGRAPHS)
  write('corrupt.docx', goodDocx.subarray(0, Math.floor(goodDocx.length / 2)))
  write('corrupt.xlsx', Buffer.from('this is definitely not a workbook', 'utf8'))
  write('mislabelled.docx', buildPlainPdf(['not a word file']))
  write('empty.docx', Buffer.alloc(0))

  return root
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) {
  const root = join(process.cwd(), '.tmp', 'fixtures')
  generateFixtures(root)
  console.log(`fixtures written to ${root}`)
}
