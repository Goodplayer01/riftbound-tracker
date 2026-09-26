const { app, BrowserWindow, shell, ipcMain, Menu, nativeImage } = require('electron')
const path = require('path')
const fs = require('fs')

const isDev = !app.isPackaged
let mainWindow

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

function createWindow() {
  const iconPath = resolveAppIcon()
  const icon = iconPath ? nativeImage.createFromPath(iconPath) : undefined
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
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
ipcMain.handle('window:maximize', () => {
  if (!mainWindow) return false
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize()
    return false
  }
  mainWindow.maximize()
  return true
})
ipcMain.handle('window:isMaximized', () => !!mainWindow?.isMaximized())
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
