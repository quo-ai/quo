'use strict';

// Renders each kind of approval request and saves a screenshot of it to /tmp/quo-approval-<name>.png, to look at the design:
//   npx electron scripts/preview-approval.js
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');
const { askInApp } = require('../src/approval/window');

const DIFF = ['@@ -1,6 +1,9 @@', ' <!doctype html>', ' <html lang="en">', ' <head>', '-  <title>Todo</title>', '+  <title>Todo app</title>', '+  <link rel="stylesheet" href="style.css">', ' </head>', ' <body>', '+  <main id="app"></main>', ' </body>'].join('\n');
const SAMPLES = {
  edit: { kind: 'edit', title: 'Edit index.html?', project: 'todo-app', rememberLabel: 'Allow edits to this project for this session', view: { kind: 'edit', action: 'edit', file: 'index.html', added: 4, removed: 1, diff: DIFF } },
  create: { kind: 'edit', title: 'Create style.css?', project: 'todo-app', rememberLabel: 'Allow edits to this project for this session', view: { kind: 'edit', action: 'create', file: 'style.css', added: 6, removed: 0, diff: ['@@ -0,0 +1,6 @@', '+body {', '+  font-family: system-ui;', '+  margin: 0;', '+}', '+#app { padding: 24px; }'].join('\n') } },
  command: { kind: 'command', title: 'Run this command?', project: 'todo-app', rememberLabel: 'Allow this exact command for this session', view: { kind: 'command', command: 'npm run build && npm test -- --run', background: false } },
  background: { kind: 'command', title: 'Start this command in the background?', project: 'todo-app', rememberLabel: 'Allow this exact command for this session', view: { kind: 'command', command: 'npm run dev', background: true } },
  commit: { kind: 'commit', title: 'Commit 3 files to main?', project: 'todo-app', view: { kind: 'commit', branch: 'main', author: `Pat Person <${'pat' + '@example.test'}>`, files: ['index.html', 'style.css', 'app.js'], message: 'Add a todo list page\n\nList, add and remove items; saved in localStorage.', credit: 'Co-Authored-By: Quo <345051252+quo-code@users.noreply.github.com>' } },
  read: { kind: 'read', title: 'Let Quo read files in this folder?', project: 'todo-app', rememberLabel: 'Allow reading here for this session', view: { kind: 'read', folder: path.join(os.tmpdir(), 'shared-config') } },
  folder: { kind: 'folder', title: 'Make a folder for this?', project: '', view: { kind: 'folder', mode: 'new', name: 'todo-app', where: 'Documents/Quo Projects' } },
  work: { kind: 'folder', title: 'Let Quo work in quo?', project: '', view: { kind: 'folder', mode: 'existing', name: 'quo', where: '~/Desktop/localai' } },
  open: { kind: 'open', title: 'Open index.html in your browser?', project: 'todo-app', rememberLabel: 'Allow opening pages for this session', view: { kind: 'open', what: 'file', target: 'index.html' } },
};

app.whenReady().then(async () => {
  const parent = new BrowserWindow({ width: 1100, height: 760, show: true, backgroundColor: '#f3f2fb' });
  await parent.loadURL('data:text/html,<body style="background:%23f3f2fb;font:20px system-ui;padding:40px">Quo (preview behind the approval window)</body>');
  for (const [name, request] of Object.entries(SAMPLES)) {
    const pending = askInApp(parent, request);
    await new Promise(resolve => setTimeout(resolve, 1600));
    const window = BrowserWindow.getAllWindows().find(w => w !== parent && !w.isDestroyed());
    if (window) {
      const image = await window.webContents.capturePage();
      fs.writeFileSync(path.join('/tmp', `quo-approval-${name}.png`), image.toPNG());
      window.destroy();
    }
    console.log(name, window ? 'saved' : 'no window', await pending);
  }
  app.quit();
});
