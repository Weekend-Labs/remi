const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('buddy', {
  onShow: (cb) => ipcRenderer.on('reminder:show', (_e, data) => cb(data)),
  action: (a) => ipcRenderer.send('reminder:action', a),
  hide: () => ipcRenderer.send('reminder:hide'),
});
