'use strict';

const { contextBridge } = require('electron');

// The version is passed in by the main process (webPreferences.additionalArguments):
// sandboxed preloads can't read package.json.
const VERSION_ARG = '--quo-version=';
const version = process.argv.find(arg => arg.startsWith(VERSION_ARG))?.slice(VERSION_ARG.length) ?? '';

// Contract with the web app (apps/web/src/platform.ts): keep exactly this shape.
contextBridge.exposeInMainWorld('quoDesktop', { platform: process.platform, version });
