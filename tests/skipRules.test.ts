import { describe, expect, it } from 'vitest'
import { createSkipRules, systemRootsFromEnv } from '@main/indexer/skipRules'

const env = {
  SystemRoot: 'C:\\Windows',
  ProgramFiles: 'C:\\Program Files',
  'ProgramFiles(x86)': 'C:\\Program Files (x86)',
  ProgramData: 'C:\\ProgramData',
  LOCALAPPDATA: 'C:\\Users\\Ziad\\AppData\\Local',
  APPDATA: 'C:\\Users\\Ziad\\AppData\\Roaming'
}

const rules = createSkipRules(env)

describe('systemRootsFromEnv', () => {
  it('collects the Windows sensitive roots, normalized and de-duplicated', () => {
    const roots = systemRootsFromEnv(env)
    expect(roots).toContain('c:\\windows')
    expect(roots).toContain('c:\\program files')
    expect(roots).toContain('c:\\programdata')
    expect(roots).toContain('c:\\users\\ziad\\appdata\\roaming')
    expect(new Set(roots).size).toBe(roots.length)
  })

  it('tolerates a missing environment', () => {
    expect(systemRootsFromEnv({})).toEqual([])
  })
})

describe('shouldSkipDirectory', () => {
  it('skips system roots and anything below them', () => {
    expect(rules.shouldSkipDirectory('System32', 'C:\\Windows\\System32')).toBe('system_directory')
    expect(rules.shouldSkipDirectory('Windows', 'C:\\Windows')).toBe('system_directory')
    expect(rules.shouldSkipDirectory('Temp', 'C:\\Users\\Ziad\\AppData\\Local\\Temp')).toBe(
      'user_profile_appdata'
    )
  })

  it('skips tooling and hidden directories anywhere', () => {
    expect(rules.shouldSkipDirectory('node_modules', 'C:\\Work\\app\\node_modules')).toBe(
      'system_or_tooling_directory'
    )
    expect(rules.shouldSkipDirectory('.git', 'C:\\Work\\.git')).toBe('hidden_directory')
    expect(rules.shouldSkipDirectory('.cache', 'C:\\Work\\.cache')).toBe('hidden_directory')
  })

  it('keeps ordinary work folders', () => {
    expect(rules.shouldSkipDirectory('Reports', 'C:\\Work\\Reports')).toBeNull()
    expect(rules.shouldSkipDirectory('2026', 'C:\\Work\\Reports\\2026')).toBeNull()
    expect(rules.shouldSkipDirectory('مستندات', 'D:\\مستندات')).toBeNull()
  })
})

describe('shouldSkipFile', () => {
  it('skips shell bookkeeping and Office lock files', () => {
    expect(rules.shouldSkipFile('Thumbs.db')).toBe('shell_bookkeeping_file')
    expect(rules.shouldSkipFile('desktop.ini')).toBe('shell_bookkeeping_file')
    expect(rules.shouldSkipFile('~$report.docx')).toBe('office_lock_file')
    expect(rules.shouldSkipFile('.hidden')).toBe('hidden_file')
  })

  it('keeps real documents', () => {
    expect(rules.shouldSkipFile('report.docx')).toBeNull()
    expect(rules.shouldSkipFile('تقرير-الميزانية.xlsx')).toBeNull()
    expect(rules.shouldSkipFile('scan.pdf')).toBeNull()
  })
})
