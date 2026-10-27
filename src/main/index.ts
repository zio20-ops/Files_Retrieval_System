import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { app, BrowserWindow } from 'electron'
import { getDatabasePath, getPreloadPath, getRendererIndexPath } from './app-paths'
import { openDatabase, type Db } from './db/database'
import * as repo from './db/repository'
import { ExtractorRegistry } from './extractors/registry'
import { registerBuiltinExtractors } from './extractors'
import { disposeIpc, registerIpc } from './ipc'
import { resolveOcrAssets } from './ocr/assets'
import { OcrService } from './ocr/ocrService'

let mainWindow: BrowserWindow | null = null
let db: Db | null = null
let ocr: OcrService | null = null

function sanitize(value: string): string {
  return value.replace(/[^a-z0-9_-]/gi, '')
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 620,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#F5F3EE',
    title: 'File Finder',
    webPreferences: {
      preload: getPreloadPath(),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())

  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) {
    void mainWindow.loadURL(devUrl)
  } else {
    void mainWindow.loadFile(getRendererIndexPath())
  }

  // Test hook: `SMOKE_SHOT=/abs/path.png` captures the running UI and exits, so
  // the interface can be verified without manual interaction. It always
  // terminates the process, successfully or not, so CI cannot hang.
  if (process.env.SMOKE_SHOT) {
    attachSmokeTest(
      mainWindow,
      process.env.SMOKE_SHOT,
      process.env.SMOKE_NAV,
      process.env.SMOKE_CLICK,
      process.env.SMOKE_TYPE,
      process.env.SMOKE_SHOT_PROGRESS,
      Number(process.env.SMOKE_PROGRESS_WAIT ?? 6000),
      Number(process.env.SMOKE_SETTLE ?? 0),
      Number(process.env.SMOKE_TIMEOUT_MS ?? 30000)
    )
  }
}

function attachSmokeTest(
  window: BrowserWindow,
  shotPath: string,
  navId?: string,
  clickAction?: string,
  typeText?: string,
  progressShot?: string,
  progressWait = 6000,
  settle = 0,
  timeoutMs = 30000
): void {
  const webContents = window.webContents
  let settled = false

  webContents.on('console-message', (_event, level, message, line, source) => {
    console.log(`[renderer ${level}] ${message} (${source}:${line})`)
  })
  webContents.on('did-fail-load', (_event, code, description, url) => {
    console.log(`[renderer fail] ${code} ${description} ${url}`)
  })

  const finish = async (): Promise<void> => {
    if (settled) return
    settled = true
    window.show()
    await new Promise((resolve) => setTimeout(resolve, 1200))
    try {
      const image = await webContents.capturePage()
      mkdirSync(dirname(shotPath), { recursive: true })
      writeFileSync(shotPath, image.toPNG())
      console.log(`SMOKE_OK size=${image.getSize().width}x${image.getSize().height} shot=${shotPath}`)
      app.exit(0)
    } catch (error) {
      console.log(`SMOKE_FAIL ${error instanceof Error ? error.message : String(error)}`)
      app.exit(1)
    }
  }

  webContents.once('did-finish-load', () => {
    void (async () => {
      // With a progress shot the app navigates first (so the progress panel is
      // on screen), the click starts a long run, the shot is taken mid-run,
      // then the usual search flow finishes.
      if (progressShot && clickAction) {
        if (navId) {
          const moved = await click(`[data-nav="${sanitize(navId)}"]`)
          console.log(`[smoke] nav=${navId} clicked=${String(moved)}`)
        }
        const started = await click(`[data-action="${sanitize(clickAction)}"]`)
        console.log(`[smoke] action=${clickAction} clicked=${String(started)}`)
        await new Promise((resolve) => setTimeout(resolve, progressWait))
        const image = await webContents.capturePage()
        mkdirSync(dirname(progressShot), { recursive: true })
        writeFileSync(progressShot, image.toPNG())
        console.log(`[smoke] progress shot=${progressShot}`)
        if (settle > 0) await new Promise((resolve) => setTimeout(resolve, settle))
      }
      if (navId && !progressShot) {
        const clicked = await click(`[data-nav="${sanitize(navId)}"]`)
        console.log(`[smoke] nav=${navId} clicked=${String(clicked)}`)
      }
      if (typeText) {
        const typed = await type('[data-input="search"]', typeText)
        console.log(`[smoke] typed=${String(typed)}`)
        await new Promise((resolve) => setTimeout(resolve, 250))
        const submitted = await click('[data-action="search"]')
        console.log(`[smoke] submitted=${String(submitted)}`)
        await new Promise((resolve) => setTimeout(resolve, 1500))
      }
      if (clickAction && !progressShot) {
        const clicked = await click(`[data-action="${sanitize(clickAction)}"]`)
        console.log(`[smoke] action=${clickAction} clicked=${String(clicked)}`)
        await new Promise((resolve) => setTimeout(resolve, 2500))
      }
      await finish()
    })()
  })

  function click(selector: string): Promise<unknown> {
    return webContents
      .executeJavaScript(
        `(() => { const el = document.querySelector('${selector}'); if (!el) return false; el.click(); return true })()`
      )
      .catch(() => false)
  }

  /** React owns the input value, so it is set through the native setter plus an input event. */
  function type(selector: string, value: string): Promise<unknown> {
    const script = `(() => {
      const el = document.querySelector(${JSON.stringify(selector)})
      if (!el) return false
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(el, ${JSON.stringify(value)})
      el.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    })()`
    return webContents.executeJavaScript(script).catch(() => false)
  }
  // Safety nets: a page that never finishes loading must not block forever.
  setTimeout(() => {
    if (!webContents.isLoading()) void finish()
  }, 8000)
  setTimeout(() => {
    console.log('SMOKE_TIMEOUT')
    app.exit(2)
  }, timeoutMs).unref?.()
}

app.whenReady().then(async () => {
  const dbPath = getDatabasePath()
  db = openDatabase(dbPath)
  ocr = new OcrService(resolveOcrAssets())
  const registry = new ExtractorRegistry()
  registerBuiltinExtractors(registry, ocr)
  const { indexer } = registerIpc({
    db,
    dbPath,
    version: app.getVersion(),
    registry,
    ocr
  })
  console.log(`[main] ready db=${dbPath} ocr=${ocr.available ? ocr.languages : 'unavailable'}`)

  // Test hook: index a real folder before the window opens so the captured
  // screenshot shows populated views instead of empty states.
  // SMOKE_SEED_ONLY=1 registers the folder but keeps the previous index, which
  // lets a smoke run exercise per-file re-indexing of an edited file.
  const seed = process.env.SMOKE_SEED
  if (seed) {
    const folder = resolve(seed)
    repo.addFolder(db, folder)
    if (process.env.SMOKE_SEED_ONLY === '1') {
      console.log(`[smoke] seeded without re-indexing=${folder}`)
    } else {
      await indexer.run('full')
      console.log(`[smoke] seeded=${folder} stats=${JSON.stringify(repo.getStats(db, 0))}`)
    }
  }

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  disposeIpc()
  void ocr?.dispose()
  db?.close()
  db = null
})
