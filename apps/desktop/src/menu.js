'use strict';

const { app, Menu, shell } = require('electron');
const { readUpdateChecks, writeUpdateChecks } = require('./updater');

const LINKS = {
  website: 'https://quo.computer',
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
        { type: 'separator' },
        // The only thing Quo contacts by itself: GitHub, once at start-up, for a new version.
        { label: 'Check for Updates at Start-up', type: 'checkbox', checked: readUpdateChecks(), click: item => writeUpdateChecks(item.checked) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

module.exports = { buildMenu };
