const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('buddy', {
  onShow: (cb) => ipcRenderer.on('reminder:show', (_e, data) => cb(data)),
  onCelebrate: (cb) => ipcRenderer.on('reminder:celebrate', (_e, data) => cb(data)),
  onNotify: (cb) => ipcRenderer.on('notification:show', (_e, data) => cb(data)), // F001 info peeks

  action: (a) => ipcRenderer.send('reminder:action', a),
  hide: () => ipcRenderer.send('reminder:hide'),
});

// Calendar/progress window reads the per-day history map.
contextBridge.exposeInMainWorld('remi', {
  getHistory: () => ipcRenderer.invoke('history:get'),
});
