const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('riftbound', {
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
  reload: () => ipcRenderer.invoke('app:reload'),
  installUpdate: () => ipcRenderer.invoke('updater:install'),
  downloadUpdate: () => ipcRenderer.invoke('updater:download'),
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  onUpdater: (cb) => {
    const listener = (_event, payload) => cb(payload)
    ipcRenderer.on('updater', listener)
    return () => ipcRenderer.removeListener('updater', listener)
  },
  windowMinimize: () => ipcRenderer.invoke('window:minimize'),
  windowToggleFullscreen: () => ipcRenderer.invoke('window:toggleFullscreen'),
  windowIsFullScreen: () => ipcRenderer.invoke('window:isFullScreen'),
  onFullscreen: (cb) => {
    const listener = (_event, isFullScreen) => cb(!!isFullScreen)
    ipcRenderer.on('window:fullscreen', listener)
    return () => ipcRenderer.removeListener('window:fullscreen', listener)
  },
  windowClose: () => ipcRenderer.invoke('window:close'),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  copyImage: (dataUrl) => ipcRenderer.invoke('clipboard:writeImage', dataUrl),
  fetchJson: (url) => ipcRenderer.invoke('net:fetchJson', url),
  cardtrader: (path, token) => ipcRenderer.invoke('net:cardtrader', path, token),
  rbEvents: (req) => ipcRenderer.invoke('net:rbEvents', req),
  fetchImageDataUrl: (url) => ipcRenderer.invoke('net:fetchImageDataUrl', url),
  backupList: () => ipcRenderer.invoke('backup:list'),
  backupWrite: (kind, text) => ipcRenderer.invoke('backup:write', kind, text),
  backupRead: (name) => ipcRenderer.invoke('backup:read', name),
  backupExportAs: (text) => ipcRenderer.invoke('backup:exportAs', text),
  backupImportFile: () => ipcRenderer.invoke('backup:importFile'),
  backupOpenFolder: () => ipcRenderer.invoke('backup:openFolder'),
  backupChooseFolder: () => ipcRenderer.invoke('backup:chooseFolder'),
})
