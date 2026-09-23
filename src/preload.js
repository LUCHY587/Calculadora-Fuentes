'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getState: () => ipcRenderer.invoke('indices:get'),
  refresh: () => ipcRenderer.invoke('indices:refresh'),
  openExternal: (url) => ipcRenderer.invoke('app:open-external', url),
  version: () => ipcRenderer.invoke('app:version'),
  copyImage: (bytes) => ipcRenderer.invoke('app:copy-image', bytes),
  saveFile: (opts) => ipcRenderer.invoke('app:save-file', opts),
  onChanged: (cb) => {
    const handler = (_e, state) => cb(state);
    ipcRenderer.on('indices:changed', handler);
    return () => ipcRenderer.removeListener('indices:changed', handler);
  },
});
