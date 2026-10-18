'use strict';

// Remembers the main window's size, position and maximized state.

const fs = require('node:fs');
const path = require('node:path');
const { app, screen } = require('electron');

const DEFAULT_SIZE = { width: 1280, height: 820 };
const MIN_SIZE = { width: 800, height: 560 };

const stateFile = () => path.join(app.getPath('userData'), 'window-state.json');

function loadWindowState() {
  try {
    const saved = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    const bounds = {
      width: Math.max(MIN_SIZE.width, Math.round(saved.width) || DEFAULT_SIZE.width),
      height: Math.max(MIN_SIZE.height, Math.round(saved.height) || DEFAULT_SIZE.height),
    };
    // Only restore the position if it's still on a connected display.
    if (Number.isInteger(saved.x) && Number.isInteger(saved.y) && isOnScreen({ ...bounds, x: saved.x, y: saved.y })) {
      bounds.x = saved.x;
      bounds.y = saved.y;
    }
    return { bounds, maximized: saved.maximized === true };
  } catch {
    return { bounds: { ...DEFAULT_SIZE }, maximized: false };
  }
}

function isOnScreen(bounds) {
  return screen.getAllDisplays().some(({ workArea: area }) =>
    bounds.x < area.x + area.width && bounds.x + bounds.width > area.x &&
    bounds.y < area.y + area.height && bounds.y + bounds.height > area.y);
}

function trackWindowState(win) {
  let timer;
  const save = () => {
    clearTimeout(timer);
    if (win.isDestroyed()) return;
    try {
      fs.writeFileSync(stateFile(), JSON.stringify({ ...win.getNormalBounds(), maximized: win.isMaximized() }));
    } catch (error) {
      console.warn('[window-state]', error.message);
    }
  };
  const saveSoon = () => {
    clearTimeout(timer);
    timer = setTimeout(save, 500);
  };
  for (const event of ['resize', 'move', 'maximize', 'unmaximize']) win.on(event, saveSoon);
  win.on('close', save);
}

module.exports = { MIN_SIZE, loadWindowState, trackWindowState };
