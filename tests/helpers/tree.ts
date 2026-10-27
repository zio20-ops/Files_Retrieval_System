import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * Test trees live under <project>/.tmp so no file is ever created outside the
 * working directory.
 */
export function makeTempRoot(name: string): string {
  const root = join(process.cwd(), '.tmp', 'tests', name)
  rmSync(root, { recursive: true, force: true })
  mkdirSync(root, { recursive: true })
  return root
}

export function writeTreeFile(root: string, relativePath: string, content = 'x'): string {
  const absolute = join(root, relativePath)
  mkdirSync(dirname(absolute), { recursive: true })
  writeFileSync(absolute, content)
  return absolute
}

export function writeTreeSymlink(root: string, target: string, relativePath: string): string {
  const absolute = join(root, relativePath)
  mkdirSync(dirname(absolute), { recursive: true })
  symlinkSync(target, absolute, 'junction')
  return absolute
}

export function cleanupTempRoot(root: string): void {
  rmSync(root, { recursive: true, force: true })
}
