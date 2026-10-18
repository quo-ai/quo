'use strict';

const { app, Menu, shell } = require('electron');

const LINKS = {
  website: 'https://quoai.vercel.app',
  source: 'https://github.com/quo-ai/quo',
  issues: 'https://github.com/quo-ai/quo/issues/new/choose',
};

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    isMac ? { role: 'appMenu' } : { role: 'fileMenu' },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' }]),
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        { label: 'Quo website', click: () => shell.openExternal(LINKS.website) },
        { label: 'Source code on GitHub', click: () => shell.openExternal(LINKS.source) },
        { type: 'separator' },
        { label: 'Report an issue', click: () => shell.openExternal(LINKS.issues) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

module.exports = { buildMenu };
