import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Builds a genuinely scanned PDF (raster pages, no text layer) with Arabic and
 * English lines. Windows GDI+ renders the text (real Arabic shaping), then the
 * JPEG pages are embedded as image XObjects, exactly like a scanner output.
 * Run: npm run fixtures:scanned
 */

const PAGES = [
  [
    'تقرير الفاتورة الممسوحة للمورد الرئيسي',
    'اعتماد رقم الفاتورة 2026-555 من الإدارة',
    'Scanned page one: zebra quadrant delta',
    'Approved by the finance office on Monday'
  ],
  [
    'اعتماد الميزانية النهائية من الإدارة المالية',
    'ملاحظات المدقق على الفاتورة الممسوحة',
    'Second scanned page: quartz jelly vortex',
    'Total amount due at the end of quarter'
  ]
]

const renderDir = join(process.cwd(), '.tmp', 'scan-render')
const outPath = join(process.cwd(), 'tests', 'fixtures', 'scanned-ara-eng.pdf')
mkdirSync(renderDir, { recursive: true })
mkdirSync(join(process.cwd(), 'tests', 'fixtures'), { recursive: true })

function psQuote(value) {
  return `'${value.replaceAll("'", "''")}'`
}

const renderCalls = PAGES.map(
  (lines, index) =>
    `Render-Page ${psQuote(join(renderDir, `page-${index + 1}.jpg`))} @(${lines
      .map(psQuote)
      .join(', ')})`
).join('\n')

// BOM so Windows PowerShell 5.1 reads the Arabic literals as UTF-8.
const script = `\uFEFFAdd-Type -AssemblyName System.Drawing
$ErrorActionPreference = 'Stop'
function Render-Page([string]$out, [string[]]$lines) {
  $bmp = New-Object System.Drawing.Bitmap(1240, 1754)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.Clear([System.Drawing.Color]::White)
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $font = New-Object System.Drawing.Font('Segoe UI', 40)
  $brush = [System.Drawing.Brushes]::Black
  $y = 160
  foreach ($line in $lines) {
    $rect = New-Object System.Drawing.RectangleF(90, $y, 1060, 130)
    $g.DrawString($line, $font, $brush, $rect)
    $y += 170
  }
  $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
  $params = New-Object System.Drawing.Imaging.EncoderParameters(1)
  $params.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]92)
  $bmp.Save($out, $codec, $params)
  $font.Dispose(); $g.Dispose(); $bmp.Dispose()
}
${renderCalls}
Write-Output 'rendered'
`

const ps1 = join(renderDir, 'render.ps1')
writeFileSync(ps1, script, 'utf8')
const ran = spawnSync(
  'powershell.exe',
  ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1],
  { encoding: 'utf8' }
)
if (ran.status !== 0) {
  console.error(ran.stdout ?? '')
  console.error(ran.stderr ?? '')
  process.exit(1)
}

function jpegSize(buffer) {
  let offset = 2
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1
      continue
    }
    const marker = buffer[offset + 1]
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) }
    }
    offset += 2 + buffer.readUInt16BE(offset + 2)
  }
  throw new Error('JPEG SOF marker not found')
}

const pages = PAGES.map((_, index) => {
  const jpeg = readFileSync(join(renderDir, `page-${index + 1}.jpg`))
  return { jpeg, ...jpegSize(jpeg) }
})

/* ------------------------------------------------------- minimal PDF writer */

const objects = new Map()
const pageNumbers = []
let next = 3
for (let i = 0; i < pages.length; i += 1) {
  pageNumbers.push({ page: next, content: next + 1, image: next + 2 })
  next += 3
}

objects.set(1, Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'))
objects.set(
  2,
  Buffer.from(
    `<< /Type /Pages /Kids [${pageNumbers
      .map((numbers) => `${numbers.page} 0 R`)
      .join(' ')}] /Count ${pages.length} >>`
  )
)

pages.forEach((page, index) => {
  const { page: pageNumber, content: contentNumber, image: imageNumber } = pageNumbers[index]
  const widthPt = (page.width * 0.48).toFixed(2)
  const heightPt = (page.height * 0.48).toFixed(2)
  objects.set(
    pageNumber,
    Buffer.from(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${widthPt} ${heightPt}] /Contents ${contentNumber} 0 R /Resources << /XObject << /Im0 ${imageNumber} 0 R >> >> >>`
    )
  )
  const content = Buffer.from(`q ${widthPt} 0 0 ${heightPt} 0 0 cm /Im0 Do Q\n`, 'latin1')
  objects.set(
    contentNumber,
    Buffer.concat([
      Buffer.from(`<< /Length ${content.length} >>\nstream\n`),
      content,
      Buffer.from('\nendstream')
    ])
  )
  objects.set(
    imageNumber,
    Buffer.concat([
      Buffer.from(
        `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`
      ),
      page.jpeg,
      Buffer.from('\nendstream')
    ])
  )
})

const chunks = [Buffer.from('%PDF-1.4\n')]
const offsets = new Map()
const maxNumber = Math.max(...objects.keys())
for (let number = 1; number <= maxNumber; number += 1) {
  const body = objects.get(number)
  if (!body) continue
  offsets.set(number, chunks.reduce((sum, chunk) => sum + chunk.length, 0))
  chunks.push(Buffer.from(`${number} 0 obj\n`), body, Buffer.from('\nendobj\n'))
}
const xrefOffset = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
const xref = [`xref\n0 ${maxNumber + 1}\n`, '0000000000 65535 f \n']
for (let number = 1; number <= maxNumber; number += 1) {
  xref.push(`${String(offsets.get(number) ?? 0).padStart(10, '0')} 00000 n \n`)
}
chunks.push(Buffer.from(xref.join('')))
chunks.push(
  Buffer.from(
    `trailer\n<< /Size ${maxNumber + 1} /Root 1 0 R /ID [<01020304050607080910111213141516> <01020304050607080910111213141516>] >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  )
)

writeFileSync(outPath, Buffer.concat(chunks))
console.log(`scanned fixture written to ${outPath} (${pages.length} pages)`)
