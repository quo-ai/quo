'use strict';

// Claude Agent uses the person's own Claude.ai login through their own Claude Code. Anthropic allows that in another
// product only with its approval, so released builds leave Claude Agent out (its code isn't started, the page gets no
// bridge for it, and the SDK isn't packaged) until Anthropic approves. Then set IN_RELEASES to true and put the SDK back
// in electron-builder.yml's extraResources; test/claude/release.test.js checks that the two agree.
const IN_RELEASES = false;

/** Whether this build offers Claude Agent: development builds always do; packaged ones only once Anthropic approves. */
const claudeAgentOffered = packaged => !packaged || IN_RELEASES;

module.exports = { IN_RELEASES, claudeAgentOffered };
