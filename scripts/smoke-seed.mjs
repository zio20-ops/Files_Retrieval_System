import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { ARABIC_PARAGRAPHS, ENGLISH_PARAGRAPHS, buildDocx, generateFixtures } from './fixtures/generate.mjs'

const root = join(process.cwd(), '.tmp', 'smoke-seed')

rmSync(root, { recursive: true, force: true })

// Real, readable documents (plus the corrupt / scanned / encrypted ones the
// generator emits) so the smoke run exercises extraction and search end to end.
generateFixtures(join(root, 'contracts'))

const extra = {
  'editable.docx': buildDocx([
    'The editable report originally said first version.',
    'This paragraph stays the same across edits.'
  ]),
  'تقارير/تقريرُ المبيعاتِ السنويّ.docx': buildDocx([
    ...ARABIC_PARAGRAPHS,
    'إجماليُ المبيعاتِ لسنةِ ٢٠٢٦ بلغَ ١٥٠٠٠٠٠ جنيه'
  ]),
  'تقارير/ملاحظات/أسماءُ الموظفينَ.docx': buildDocx([
    'أسماءُ الموظفينَ: أحمد، إسلام، مؤمن، هبة',
    'الإتّفاقيةُ تشملُ مسؤولياتِ الإدارةِ والموظّفينَ'
  ]),
  'reports/quarterly-summary.docx': buildDocx(ENGLISH_PARAGRAPHS),
  'notes/meeting notes.txt': 'plain text is searchable by name only',
  'Thumbs.db': 'shell bookkeeping, must be skipped',
  'node_modules/some-package/index.js': 'tooling folder, must be skipped'
}

for (const [relative, content] of Object.entries(extra)) {
  const absolute = join(root, relative)
  mkdirSync(dirname(absolute), { recursive: true })
  writeFileSync(absolute, content)
}

// Real scanned PDF (no text layer, Arabic + English) so the smoke run can show
// live OCR progress and prove the recognised words are searchable afterwards.
copyFileSync(
  join(process.cwd(), 'tests', 'fixtures', 'scanned-ara-eng.pdf'),
  join(root, 'scanned-invoice.pdf')
)

console.log(`seeded ${root}`)
