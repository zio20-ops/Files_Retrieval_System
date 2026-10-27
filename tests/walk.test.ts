import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createSkipRules } from '@main/indexer/skipRules'
import { walkDirectory, type WalkEntry } from '@main/indexer/walk'
import { cleanupTempRoot, makeTempRoot, writeTreeFile, writeTreeSymlink } from './helpers/tree'

const rules = createSkipRules({ SystemRoot: 'C:\\Windows' })

let root = ''
const entries: WalkEntry[] = []
const skipped: { path: string; reason: string }[] = []

beforeAll(async () => {
  root = makeTempRoot('walk')
  writeTreeFile(root, 'docs/report.txt', 'hello')
  writeTreeFile(root, 'docs/2026/q1.txt', 'hello')
  writeTreeFile(root, 'node_modules/pkg/index.js', 'x')
  writeTreeFile(root, '.hidden/secret.txt', 'x')
  writeTreeFile(root, '~$lock.docx', 'x')
  writeTreeFile(root, 'Thumbs.db', 'x')
  writeTreeSymlink(root, `${root}\\docs`, 'docs-link')

  for await (const entry of walkDirectory(root, {
    rules,
    onSkipped: (path, reason) => skipped.push({ path, reason })
  })) {
    entries.push(entry)
  }
})

afterAll(() => cleanupTempRoot(root))

describe('walkDirectory', () => {
  it('yields every ordinary file with size and mtime', () => {
    const files = entries.filter((entry) => !entry.isDirectory).map((entry) => entry.name).sort()
    expect(files).toEqual(['q1.txt', 'report.txt'])
    const report = entries.find((entry) => entry.name === 'report.txt')
    expect(report?.size).toBe(5)
    expect(report?.mtimeMs).toBeGreaterThan(0)
  })

  it('yields traversed directories so callers can count them', () => {
    const dirs = entries.filter((entry) => entry.isDirectory).map((entry) => entry.name).sort()
    expect(dirs).toEqual(['2026', 'docs'])
  })

  it('never descends into tooling or hidden directories', () => {
    expect(entries.some((entry) => entry.path.includes('node_modules'))).toBe(false)
    expect(entries.some((entry) => entry.path.includes('.hidden'))).toBe(false)
  })

  it('reports why each path was skipped', () => {
    const reasons = new Map(skipped.map((item) => [item.path.replace(root, ''), item.reason]))
    expect(reasons.get('\\node_modules')).toBe('system_or_tooling_directory')
    expect(reasons.get('\\.hidden')).toBe('hidden_directory')
    expect(reasons.get('\\~$lock.docx')).toBe('office_lock_file')
    expect(reasons.get('\\Thumbs.db')).toBe('shell_bookkeeping_file')
    expect(reasons.get('\\docs-link')).toBe('reparse_point')
  })

  it('stops immediately when cancelled', async () => {
    const seen: WalkEntry[] = []
    const generator = walkDirectory(root, { rules, isCancelled: () => true })
    for await (const entry of generator) seen.push(entry)
    expect(seen).toEqual([])
  })
})
