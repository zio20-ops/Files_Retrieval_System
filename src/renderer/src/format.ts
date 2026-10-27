import type { IndexPhase } from '@shared/types'

// Formatted values contain Latin units and month names; without an isolate an
// RTL paragraph reorders them ("4.0 KB" renders as "KB 4.0").
const LTR_ISOLATE = String.fromCharCode(0x2066)
const POP_ISOLATE = String.fromCharCode(0x2069)

export function ltr(value: string): string {
  return `${LTR_ISOLATE}${value}${POP_ISOLATE}`
}

export function formatNumber(value: number): string {
  return ltr(value.toLocaleString())
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return ltr(`${bytes} B`)
  const units = ['KB', 'MB', 'GB', 'TB']
  let size = bytes / 1024
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024
    unit += 1
  }
  return ltr(`${size >= 10 ? Math.round(size) : size.toFixed(1)} ${units[unit]}`)
}

export function formatDateTime(ts: number | null): string | null {
  if (ts === null) return null
  return ltr(
    new Date(ts).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    })
  )
}

export function isFinalPhase(phase: IndexPhase): boolean {
  return phase === 'done' || phase === 'cancelled' || phase === 'error'
}

export function isRunningPhase(phase: IndexPhase): boolean {
  return phase === 'scanning' || phase === 'extracting' || phase === 'finalizing'
}
