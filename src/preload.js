const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('buddy', {
  onShow: (cb) => ipcRenderer.on('reminder:show', (_e, data) => cb(data)),
  onCelebrate: (cb) => ipcRenderer.on('reminder:celebrate', (_e, data) => cb(data)),
  action: (a) => ipcRenderer.send('reminder:action', a),
  hide: () => ipcRenderer.send('reminder:hide'),
  // F001 notification API (shared contract with the peek lane):
  onNotify: (cb) => ipcRenderer.on('notification:show', (_e, data) => cb(data)),
  notifyReply: (id, result) => ipcRenderer.send('notification:reply', { id, result }),
  notifyDismiss: (id) => ipcRenderer.send('notification:dismiss', { id }),
});

// Calendar/progress window reads the per-day history map.
contextBridge.exposeInMainWorld('remi', {
  getHistory: () => ipcRenderer.invoke('history:get'),
});
