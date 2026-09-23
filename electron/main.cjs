const { app, BrowserWindow, shell, ipcMain } = require('electron')
const path = require('path')

const isDev = !app.isPackaged
let mainWindow

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: 'Riftbound Tracker',
    backgroundColor: '#0e1116',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

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
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.on('update-available', (info) => {
      mainWindow?.webContents.send('updater', { status: 'available', version: info.version })
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
    autoUpdater.quitAndInstall()
  } catch {}
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
