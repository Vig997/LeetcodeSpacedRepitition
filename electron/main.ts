import { app, BrowserWindow, shell, nativeImage } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Faster cold start: skip Chromium logging we don't need.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')
app.commandLine.appendSwitch('disable-logging')
app.commandLine.appendSwitch('log-level', '3')

/**
 * Fallback when the renderer never checkpointed (crash / force-kill / hook miss).
 * Copies data.db plus WAL sidecars so restore can use a consistent set.
 */
function backupAppDataDbFallback(): void {
  try {
    const appData = process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming')
    const dataDir = path.join(appData, 'leetcode-sr')
    const dbPath = path.join(dataDir, 'data.db')
    if (!fs.existsSync(dbPath)) return
    fs.copyFileSync(dbPath, path.join(dataDir, 'data.backup.db'))
    for (const side of ['-wal', '-shm'] as const) {
      const src = dbPath + side
      const dest = path.join(dataDir, `data.backup.db${side}`)
      if (fs.existsSync(src)) fs.copyFileSync(src, dest)
      else {
        try {
          fs.unlinkSync(dest)
        } catch {
          /* none */
        }
      }
    }
  } catch {
    /* best-effort */
  }
}

let rendererBackupDone = false

// One window only — two instances on the same SQLite file risk locks/corruption.
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.focus()
  })

  app.whenReady().then(createWindow)

  app.on('before-quit', () => {
    if (!rendererBackupDone) backupAppDataDbFallback()
  })

  app.on('window-all-closed', () => {
    app.quit()
  })
}

function resolveIcon(): string | undefined {
  const candidates = [
    path.join(process.resourcesPath ?? '', 'icon.ico'),
    path.join(__dirname, '../build/icon.ico'),
    path.join(__dirname, '../../build/icon.ico'),
  ]
  for (const p of candidates) {
    try {
      const img = nativeImage.createFromPath(p)
      if (!img.isEmpty()) return p
    } catch {
      /* try next */
    }
  }
  return undefined
}

function createWindow(): void {
  const icon = resolveIcon()
  const win = new BrowserWindow({
    width: 1240,
    height: 880,
    minWidth: 940,
    minHeight: 640,
    backgroundColor: '#0b0e14',
    autoHideMenuBar: true,
    title: 'LeetCode - Spaced Repetition',
    show: false,
    ...(icon ? { icon } : {}),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false,
      backgroundThrottling: false,
      spellcheck: false,
    },
  })

  win.once('ready-to-show', () => {
    win.show()
  })

  const openExternalHttp = (url: string): void => {
    try {
      const u = new URL(url)
      if (u.protocol === 'https:' || u.protocol === 'http:') {
        void shell.openExternal(url)
      }
    } catch {
      /* ignore malformed */
    }
  }
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternalHttp(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('file:') || url.startsWith(process.env.VITE_DEV_SERVER_URL ?? 'vite-never')) {
      return
    }
    event.preventDefault()
    openExternalHttp(url)
  })

  // Renderer owns WAL-safe backup; main falls back if the hook is missing/fails.
  win.on('close', (event) => {
    if (rendererBackupDone) return
    event.preventDefault()
    const timer = setTimeout(() => {
      if (!rendererBackupDone) {
        backupAppDataDbFallback()
        rendererBackupDone = true
        if (!win.isDestroyed()) win.destroy()
      }
    }, 2500)
    win.webContents
      .executeJavaScript(
        `(async () => {
          try {
            if (typeof window.__leetcodeSrCloseDb === 'function') {
              await window.__leetcodeSrCloseDb();
              return 'ok';
            }
            return 'missing';
          } catch {
            return 'err';
          }
        })()`,
      )
      .then((result) => {
        clearTimeout(timer)
        if (result !== 'ok') backupAppDataDbFallback()
        rendererBackupDone = true
        if (!win.isDestroyed()) win.destroy()
      })
      .catch(() => {
        clearTimeout(timer)
        backupAppDataDbFallback()
        rendererBackupDone = true
        if (!win.isDestroyed()) win.destroy()
      })
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}
