const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('riftbound', {
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
  installUpdate: () => ipcRenderer.invoke('updater:install'),
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  onUpdater: (cb) => {
    const listener = (_event, payload) => cb(payload)
    ipcRenderer.on('updater', listener)
    return () => ipcRenderer.removeListener('updater', listener)
  },
  windowMinimize: () => ipcRenderer.invoke('window:minimize'),
  windowMaximize: () => ipcRenderer.invoke('window:maximize'),
  windowIsMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  windowClose: () => ipcRenderer.invoke('window:close'),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
})
