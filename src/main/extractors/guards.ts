import { open, readFile, stat } from 'node:fs/promises'
import type { SkipReasonCode } from '@shared/types'
import type { ExtractOutcome as Outcome } from './registry'

export function skip(reason: SkipReasonCode, message: string): Outcome {
  return { kind: 'skip', reason, message }
}

export function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Maps filesystem failures to skip reasons so one vanished or locked file never aborts a run. */
export function fileErrorOutcome(error: unknown): Outcome | null {
  const code = (error as NodeJS.ErrnoException | null)?.code
  if (code === 'ENOENT' || code === 'ENOTDIR') return skip('missing', 'The file no longer exists')
  if (code === 'EACCES' || code === 'EPERM') return skip('access_denied', 'Windows refused read access')
  if (code === 'EBUSY') return skip('file_in_use', 'The file is open in another program')
  return null
}

export async function guardSize(path: string, maxBytes: number): Promise<Outcome | null> {
  const info = await stat(path)
  if (info.size === 0) return skip('empty_file', 'The file is empty')
  if (info.size > maxBytes) {
    return skip('too_large', `The file is larger than ${Math.round(maxBytes / 1024 / 1024)} MB`)
  }
  return null
}

export async function readWholeFile(path: string): Promise<Buffer> {
  return readFile(path)
}

export async function readHead(path: string, bytes: number): Promise<Buffer> {
  const handle = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(bytes)
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0)
    return buffer.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}

const CFB_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]

/** Office files saved with a password are OLE compound containers, not zips. */
export function isCompoundContainer(head: Buffer): boolean {
  return head.length >= 8 && CFB_MAGIC.every((byte, i) => head[i] === byte)
}

export const ZIP_MAGIC = [0x50, 0x4b]

export function isZipContainer(head: Buffer): boolean {
  return head.length >= 2 && ZIP_MAGIC.every((byte, i) => head[i] === byte)
}

export function notAContainer(container: string): Outcome {
  return skip('corrupt', `The file is not a valid ${container} container`)
}
