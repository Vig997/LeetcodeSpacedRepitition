import { app, BrowserWindow, shell, nativeImage } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

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

  app.on('window-all-closed', () => {
    app.quit()
  })
}

function resolveIcon(): string | undefined {
  // Packaged: beside resources; dev: repo build/icon.ico
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
    ...(icon ? { icon } : {}),
    webPreferences: {
      // Personal offline tool: renderer talks to SQLite directly.
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false,
    },
  })

  // LeetCode (and other http/https) links open in the default browser — never in-app.
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
    // Keep the app on its own pages; send anything else outside.
    if (url.startsWith('file:') || url.startsWith(process.env.VITE_DEV_SERVER_URL ?? 'vite-never')) {
      return
    }
    event.preventDefault()
    openExternalHttp(url)
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}
