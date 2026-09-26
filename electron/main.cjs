const { app, BrowserWindow, shell, ipcMain, Menu, nativeImage } = require('electron')
const path = require('path')
const fs = require('fs')

const isDev = !app.isPackaged
let mainWindow

/** Fixed windowed size — measured from Stefan-PC running v0.1.35 (DWM bounds @ 125% DPI → 1426×860 DIP). */
const WINDOWED_WIDTH = 1426
const WINDOWED_HEIGHT = 860

/** Reentrancy guards — Win32 crashes if setSize/setMaximumSize runs while still leaving fullscreen. */
let leavingFs = false
let applyingWindowed = false

// Windows taskbar identity — must match package.json build.appId
if (process.platform === 'win32') {
  app.setAppUserModelId('com.goodplayer01.riftboundtracker')
}

function resolveAppIcon() {
  const candidates = []
  if (app.isPackaged) {
    // Prefer icon outside asar (extraResources / asarUnpack)
    candidates.push(path.join(process.resourcesPath, 'icon.ico'))
    candidates.push(path.join(process.resourcesPath, 'app.asar.unpacked', 'electron', 'icon.ico'))
    candidates.push(path.join(process.resourcesPath, 'app.asar.unpacked', 'build', 'icon.ico'))
  }
  candidates.push(path.join(__dirname, 'icon.ico'))
  candidates.push(path.join(__dirname, '..', 'build', 'icon.ico'))

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate
    } catch {}
  }
  return null
}

function pushFullscreenState() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  try {
    mainWindow.webContents.send('window:fullscreen', mainWindow.isFullScreen())
  } catch {}
}

/**
 * Restore fixed windowed bounds. Safe to call after leave-full-screen has completed.
 * No-ops if already applying or if the window is still fullscreen (wait for leave).
 * Never calls setFullScreen — that belongs only on the enter/exit IPC path.
 */
function applyWindowedBounds() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (applyingWindowed) return
  if (mainWindow.isFullScreen()) return

  applyingWindowed = true
  try {
    if (mainWindow.isMaximized()) {
      try { mainWindow.unmaximize() } catch {}
    }
    mainWindow.setResizable(true)
    // Clear max limits so setSize can shrink from fullscreen display size.
    mainWindow.setMinimumSize(0, 0)
    mainWindow.setMaximumSize(0, 0)
    mainWindow.setSize(WINDOWED_WIDTH, WINDOWED_HEIGHT)
    mainWindow.setMinimumSize(WINDOWED_WIDTH, WINDOWED_HEIGHT)
    mainWindow.setMaximumSize(WINDOWED_WIDTH, WINDOWED_HEIGHT)
    mainWindow.setResizable(false)
    mainWindow.center()
  } catch (e) {
    console.error('applyWindowedBounds failed', e)
  } finally {
    applyingWindowed = false
  }
}

function enterFullscreen() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isFullScreen()) return
  try {
    mainWindow.setResizable(true)
    mainWindow.setMinimumSize(0, 0)
    mainWindow.setMaximumSize(0, 0)
    mainWindow.setFullScreen(true)
  } catch (e) {
    console.error('enterFullscreen failed', e)
  }
}

function exitFullscreen() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (!mainWindow.isFullScreen()) return
  if (leavingFs) return
  leavingFs = true
  try {
    // ONLY leave fullscreen here. Bounds restore happens in leave-full-screen
    // after Win32 has finished the transition (deferred), avoiding the crash.
    mainWindow.setFullScreen(false)
  } catch (e) {
    console.error('exitFullscreen failed', e)
    leavingFs = false
  }
}

function createWindow() {
  const iconPath = resolveAppIcon()
  const icon = iconPath ? nativeImage.createFromPath(iconPath) : undefined
  mainWindow = new BrowserWindow({
    width: WINDOWED_WIDTH,
    height: WINDOWED_HEIGHT,
    minWidth: WINDOWED_WIDTH,
    minHeight: WINDOWED_HEIGHT,
    maxWidth: WINDOWED_WIDTH,
    maxHeight: WINDOWED_HEIGHT,
    resizable: false,
    maximizable: false,
    fullscreenable: true,
    title: 'Deakrix Riftbound Tracker',
    backgroundColor: '#0a0c10',
    frame: false,
    autoHideMenuBar: true,
    icon: icon && !icon.isEmpty() ? icon : iconPath || undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  Menu.setApplicationMenu(null)
  mainWindow.center()

  if (isDev) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:5173')
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.on('enter-full-screen', () => {
    leavingFs = false
    pushFullscreenState()
  })

  mainWindow.on('leave-full-screen', () => {
    // Defer restore until Win32 has fully left fullscreen — synchronous
    // setSize/setMaximumSize during the transition crashes Electron on Windows.
    leavingFs = true
    pushFullscreenState()
    setTimeout(() => {
      leavingFs = false
      applyWindowedBounds()
      pushFullscreenState()
    }, 50)
  })

  mainWindow.on('maximize', () => {
    // Block OS maximize — only true fullscreen is allowed.
    // Safe mid-transition: skip if leaving FS or already applying bounds.
    if (!mainWindow || mainWindow.isDestroyed()) return
    if (leavingFs || applyingWindowed) return
    if (mainWindow.isFullScreen()) return
    try {
      mainWindow.unmaximize()
      applyWindowedBounds()
    } catch (e) {
      console.error('maximize-block failed', e)
    }
  })
}

async function setupAutoUpdater() {
  if (isDev) return
  try {
    const { autoUpdater } = require('electron-updater')
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.on('checking-for-update', () => {
      mainWindow?.webContents.send('updater', { status: 'checking' })
    })
    autoUpdater.on('update-available', (info) => {
      mainWindow?.webContents.send('updater', { status: 'available', version: info.version })
    })
    autoUpdater.on('update-not-available', (info) => {
      mainWindow?.webContents.send('updater', { status: 'not-available', version: info?.version })
    })
    autoUpdater.on('download-progress', (p) => {
      mainWindow?.webContents.send('updater', {
        status: 'downloading',
        percent: Math.round(p.percent || 0),
        version: p.version,
      })
    })
    autoUpdater.on('update-downloaded', (info) => {
      mainWindow?.webContents.send('updater', { status: 'downloaded', version: info.version })
    })
    autoUpdater.on('error', (err) => {
      mainWindow?.webContents.send('updater', { status: 'error', message: String(err) })
    })
    await autoUpdater.checkForUpdatesAndNotify()
  } catch (e) {
    console.error('updater failed', e)
  }
}

ipcMain.handle('app:getVersion', () => app.getVersion())
ipcMain.handle('updater:install', () => {
  try {
    const { autoUpdater } = require('electron-updater')
    // isSilent=true + isForceRunAfter=true → NSIS /S + relaunch
    autoUpdater.quitAndInstall(true, true)
  } catch {}
})
ipcMain.handle('updater:download', async () => {
  if (isDev) return { ok: false, error: 'dev' }
  try {
    const { autoUpdater } = require('electron-updater')
    await autoUpdater.downloadUpdate()
    return { ok: true }
  } catch (e) {
    mainWindow?.webContents.send('updater', { status: 'error', message: String(e) })
    return { ok: false, error: String(e) }
  }
})
ipcMain.handle('updater:check', async () => {
  if (isDev) {
    mainWindow?.webContents.send('updater', { status: 'not-available', version: app.getVersion() })
    return { ok: true, dev: true }
  }
  try {
    const { autoUpdater } = require('electron-updater')
    const result = await autoUpdater.checkForUpdates()
    return { ok: true, version: result?.updateInfo?.version }
  } catch (e) {
    mainWindow?.webContents.send('updater', { status: 'error', message: String(e) })
    return { ok: false, error: String(e) }
  }
})

ipcMain.handle('window:minimize', () => {
  mainWindow?.minimize()
})
/** Toggle true fullscreen (Vollbild) ↔ fixed windowed size. Returns isFullScreen. */
ipcMain.handle('window:toggleFullscreen', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return false
  if (mainWindow.isFullScreen() || leavingFs) {
    exitFullscreen()
    return false
  }
  enterFullscreen()
  return true
})
ipcMain.handle('window:isFullScreen', () => !!mainWindow?.isFullScreen())
ipcMain.handle('window:close', () => {
  mainWindow?.close()
})
ipcMain.handle('shell:openExternal', async (_e, url) => {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return { ok: false }
  await shell.openExternal(url)
  return { ok: true }
})

app.whenReady().then(() => {
  createWindow()
  setupAutoUpdater()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
