'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * All the approval window can do: be told what to show (once), say what the person chose, and say how tall it is. It
 * cannot read anything else, and the answer is only taken from this window by the main process.
 */
contextBridge.exposeInMainWorld('quoApproval', {
  onShow: callback => ipcRenderer.once('approval:show', (_event, request) => callback(request)),
  answer: choice => ipcRenderer.send('approval:answer', typeof choice === 'string' ? choice : 'deny'),
  resize: height => ipcRenderer.send('approval:resize', Number(height) || 0),
});
