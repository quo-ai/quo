'use strict';

// The document reader window's only link to main: requests in, answers out. Nothing else of Electron or Node.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('quoReader', {
  onRequest: callback => ipcRenderer.on('documents:request', (_event, request) => callback(request)),
  reply: (id, result) => ipcRenderer.send('documents:reply', id, result),
  ready: () => ipcRenderer.send('documents:ready'),
});
