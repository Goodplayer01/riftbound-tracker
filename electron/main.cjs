const { app, BrowserWindow, shell, ipcMain, Menu, nativeImage, protocol, net } = require('electron')
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')

const isDev = !app.isPackaged
let mainWindow

/** Fixed windowed size — widened in v0.2.17 so DE tab row (incl. Händler) + stats fit one line @ 125% DPI. */
const WINDOWED_WIDTH = 1560
const WINDOWED_HEIGHT = 860

/** Reentrancy guard — unmaximize inside applyWindowedBounds fires 'unmaximize' again. */
let applyingWindowed = false

// Windows taskbar identity — must match package.json build.appId
if (process.platform === 'win32') {
  app.setAppUserModelId('com.goodplayer01.riftboundtracker')
}

// rbimg://card/?u=<card image URL> serves card images from a disk cache (see cachedCardImage).
// Must be registered before app ready; "standard" + "secure" lets file:// pages load it like https.
protocol.registerSchemesAsPrivileged([
  { scheme: 'rbimg', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
])

const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = mainWindow
    if (!win || win.isDestroyed()) return
    if (win.isMinimized()) win.restore()
    if (!win.isVisible()) win.show()
    win.focus()
  })
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

/** IPC channel keeps its old 'fullscreen' name; the state it reports is now "maximized". */
function pushFullscreenState() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  try {
    mainWindow.webContents.send('window:fullscreen', mainWindow.isMaximized())
  } catch {}
}

/** Restore the fixed windowed bounds after leaving the maximized state. */
function applyWindowedBounds() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (applyingWindowed) return

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
    mainWindow.setMaximizable(false)
    mainWindow.center()
  } catch (e) {
    console.error('applyWindowedBounds failed', e)
  } finally {
    applyingWindowed = false
  }
}

/** Maximize to the work area (taskbar stays visible), not true fullscreen. */
function maximizeWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isMaximized()) return
  try {
    mainWindow.setResizable(true)
    mainWindow.setMaximizable(true)
    mainWindow.setMinimumSize(0, 0)
    mainWindow.setMaximumSize(0, 0)
    mainWindow.maximize()
  } catch (e) {
    console.error('maximizeWindow failed', e)
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
    fullscreenable: false,
    title: 'Deakrix Riftbound Tracker',
    backgroundColor: '#1c1c1e',
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
    if (/^https?:\/\//i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  // Plain links (e.g. the map's attribution) would load inside the frameless window with no way back.
  mainWindow.webContents.on('will-navigate', (e, url) => {
    e.preventDefault()
    if (/^https?:\/\//i.test(url)) shell.openExternal(url)
  })

  mainWindow.on('maximize', pushFullscreenState)

  mainWindow.on('unmaximize', () => {
    // Defer like the old fullscreen path: resizing mid-transition is fragile on Win32.
    pushFullscreenState()
    setTimeout(() => {
      applyWindowedBounds()
      pushFullscreenState()
    }, 50)
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
/** Toggle maximized ↔ fixed windowed size. Returns isMaximized (old channel name kept for the preload API). */
ipcMain.handle('window:toggleFullscreen', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return false
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize()
    return false
  }
  maximizeWindow()
  return true
})
ipcMain.handle('window:isFullScreen', () => !!mainWindow?.isMaximized())
ipcMain.handle('window:close', () => {
  mainWindow?.close()
})


function publicShopHost(host) {
  if (!host || host.includes(':') || !host.includes('.')) return false
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false
  const h = host.toLowerCase()
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return false
  return true
}

ipcMain.handle('net:fetchJson', async (_e, url) => {
  if (typeof url !== 'string' || !/^https:\/\//i.test(url)) {
    return { ok: false, error: 'invalid url' }
  }
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return { ok: false, error: 'invalid url' }
  }
  const allowed = new Set([
    'api.riftbound.uvsgames.com',
    'api.cloudflare.riftbound.uvsgames.com',
    'nominatim.openstreetmap.org',
  ])
  // Shopify predictive search only, and only for the fixed Riftbound query.
  const shopifySuggest = parsed.pathname === '/search/suggest.json'
    && parsed.searchParams.get('q') === 'riftbound'
    && publicShopHost(parsed.hostname)
  if (!allowed.has(parsed.hostname) && !shopifySuggest) {
    return { ok: false, error: 'host not allowed' }
  }
  try {
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'DeakrixRiftboundTracker/' + app.getVersion() + ' (store locator)',
      },
      signal: AbortSignal.timeout(12000),
    })
    if (!res.ok) {
      return { ok: false, error: 'HTTP ' + res.status }
    }
    const data = await res.json()
    return { ok: true, data }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
})


function cardImageHostAllowed(host) {
  return host === 'cmsassets.rgpub.io' ||
    host.endsWith('.rgpub.io') ||
    host === 'cdn.piltoverarchive.com' ||
    host.endsWith('.piltoverarchive.com') ||
    host === 'static.dotgg.gg' ||
    host === 'riftcompare.com'
}

/** Returns the parsed URL when it is an https card image on an allowed host, else null. */
function parseCardImageUrl(url) {
  if (typeof url !== 'string' || !/^https:\/\//i.test(url)) return null
  try {
    const parsed = new URL(url)
    return cardImageHostAllowed(parsed.hostname) ? parsed : null
  } catch {
    return null
  }
}

function sniffImageMime(buf) {
  if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png'
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  if (buf.length >= 4 && buf.toString('ascii', 0, 4) === 'GIF8') return 'image/gif'
  if (buf.length >= 12 && buf.toString('ascii', 4, 12).startsWith('ftypavi')) return 'image/avif'
  return null
}

let imageCacheDir = null
function getImageCacheDir() {
  if (!imageCacheDir) {
    imageCacheDir = path.join(app.getPath('userData'), 'card-image-cache')
    fs.mkdirSync(imageCacheDir, { recursive: true })
  }
  return imageCacheDir
}

/** In-flight downloads, so a grid asking for the same image twice fetches it once. */
const imageDownloads = new Map()

/**
 * Card image bytes from the disk cache, downloading on first use.
 * Card image URLs are content-addressed (a new image gets a new URL), so entries never expire.
 */
async function cachedCardImage(url) {
  const file = path.join(getImageCacheDir(), crypto.createHash('sha1').update(url).digest('hex'))
  try {
    const buf = await fs.promises.readFile(file)
    const mime = sniffImageMime(buf)
    if (mime) return { buf, mime }
  } catch {}
  let pending = imageDownloads.get(url)
  if (!pending) {
    pending = (async () => {
      const res = await net.fetch(url, {
        headers: {
          Accept: 'image/*,*/*',
          'User-Agent': 'DeakrixRiftboundTracker/' + app.getVersion() + ' (card images)',
        },
        signal: AbortSignal.timeout(20000),
      })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.length > 12 * 1024 * 1024) throw new Error('image too large')
      const mime = sniffImageMime(buf)
      if (!mime) throw new Error('not an image')
      const tmp = file + '.' + process.pid + '.tmp'
      try {
        await fs.promises.writeFile(tmp, buf)
        await fs.promises.rename(tmp, file)
      } catch {
        fs.promises.unlink(tmp).catch(() => {})
      }
      return { buf, mime }
    })().finally(() => imageDownloads.delete(url))
    imageDownloads.set(url, pending)
  }
  return pending
}

function handleCardImageProtocol() {
  protocol.handle('rbimg', async (req) => {
    const target = parseCardImageUrl(new URL(req.url).searchParams.get('u'))
    if (!target) return new Response('not allowed', { status: 403 })
    try {
      const { buf, mime } = await cachedCardImage(target.href)
      return new Response(buf, {
        headers: {
          'Content-Type': mime,
          'Cache-Control': 'public, max-age=31536000, immutable',
          'Access-Control-Allow-Origin': '*',
        },
      })
    } catch (e) {
      return new Response(String(e), { status: 502 })
    }
  })
}

ipcMain.handle('net:fetchImageDataUrl', async (_e, url) => {
  const parsed = parseCardImageUrl(url)
  if (!parsed) return { ok: false, error: 'invalid url' }
  try {
    const { buf, mime } = await cachedCardImage(parsed.href)
    return { ok: true, dataUrl: 'data:' + mime + ';base64,' + buf.toString('base64') }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
})

ipcMain.handle('shell:openExternal', async (_e, url) => {
  if (typeof url !== 'string' || !/^(https?:\/\/|mailto:)/i.test(url)) return { ok: false }
  await shell.openExternal(url)
  return { ok: true }
})

app.whenReady().then(() => {
  if (!gotSingleInstanceLock) {
    app.quit()
    return
  }
  handleCardImageProtocol()
  createWindow()
  setupAutoUpdater()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
