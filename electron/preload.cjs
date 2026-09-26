const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('riftbound', {
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
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
})
