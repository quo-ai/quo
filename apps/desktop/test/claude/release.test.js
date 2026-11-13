'use strict';

// Claude Agent is in released builds while src/claude/release.js says so. Checks the switch, and that packaging agrees
// with it: the SDK is in a release exactly when Claude Agent is, and Anthropic's own copy of Claude Code never is.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { it } = require('node:test');
const { IN_RELEASES, claudeAgentOffered } = require('../../src/claude/release');

it('is offered in development builds, and in packaged ones only when released', () => {
  assert.equal(claudeAgentOffered(false), true);
  assert.equal(claudeAgentOffered(true), IN_RELEASES);
});

it('packages the SDK exactly when releases offer Claude Agent', () => {
  const config = fs.readFileSync(path.join(__dirname, '../../electron-builder.yml'), 'utf8');
  const packaged = config.split('\n').some(line => !line.trim().startsWith('#') && line.includes('claude-agent-sdk'));
  assert.equal(packaged, IN_RELEASES);
});

it('gives the page the Claude Agent bridge only where it is offered', () => {
  const main = fs.readFileSync(path.join(__dirname, '../../src/main.js'), 'utf8');
  const preload = fs.readFileSync(path.join(__dirname, '../../src/preload.js'), 'utf8');
  assert.match(main, /claudeAgentOffered\(app\.isPackaged\) \? \['--quo-claude=1'\]/);
  assert.match(main, /if \(claudeAgentOffered\(app\.isPackaged\)\) setupClaude\(\);/);
  assert.match(preload, /\.\.\.\(hasClaude && \{\s*claude: \{/);
});
