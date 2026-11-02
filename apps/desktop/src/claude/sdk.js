'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

/**
 * Anthropic's Claude Agent SDK, loaded the first time Claude Agent is used. A packaged app carries only the SDK's own
 * code file, in its resources (electron-builder.yml): the npm package also brings Anthropic's own copy of Claude Code,
 * which Quo never runs. In development it comes from node_modules.
 */

let loading = null;

function sdkFile() {
  const packaged = process.resourcesPath ? path.join(process.resourcesPath, 'claude-agent-sdk', 'sdk.mjs') : null;
  return packaged && fs.existsSync(packaged) ? packaged : require.resolve('@anthropic-ai/claude-agent-sdk');
}

function loadSdk() {
  loading ??= import(pathToFileURL(sdkFile()).href).catch(error => {
    // Let the next request try again.
    loading = null;
    throw error;
  });
  return loading;
}

module.exports = { loadSdk };
