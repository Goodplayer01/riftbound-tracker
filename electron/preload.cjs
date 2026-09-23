const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('riftbound', {
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
  installUpdate: () => ipcRenderer.invoke('updater:install'),
  onUpdater: (cb) => {
    const listener = (_event, payload) => cb(payload)
    ipcRenderer.on('updater', listener)
    return () => ipcRenderer.removeListener('updater', listener)
  },
})
