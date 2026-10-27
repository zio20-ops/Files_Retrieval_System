import { app } from 'electron'
import { join } from 'node:path'

/**
 * In development the database lives inside the project so that no state is
 * written outside the working tree. Packaged builds use the standard per-user
 * Windows location (%APPDATA%/file-finder).
 */
export function getDataDir(): string {
  return app.isPackaged ? app.getPath('userData') : join(app.getAppPath(), '.dev-data')
}

export function getDatabasePath(): string {
  return join(getDataDir(), 'index.db')
}

/** Works both from `out/main` in dev and from inside the packaged asar. */
export function getPreloadPath(): string {
  return join(app.getAppPath(), 'out', 'preload', 'index.cjs')
}

export function getRendererIndexPath(): string {
  return join(app.getAppPath(), 'out', 'renderer', 'index.html')
}
