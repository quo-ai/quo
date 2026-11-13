'use strict';

// Claude Agent runs the person's own, unmodified Claude Code with their own sign-in. Anthropic's terms for running
// Claude Code in another product (https://code.claude.com/docs/en/legal-and-compliance, "Can customers offer Claude Code
// in their products?", read 2026-11-13) are the rules this feature keeps, and a change that breaks one must turn this off:
//   - Claude Code is not modified, shipped or downloaded by Quo: only the person's own install runs (locate.js).
//   - No sign-in method of Claude Code is removed or restricted: a plan, an API key and a cloud provider all work.
//   - The person signs in themselves, in Anthropic's own flow (`claude auth login`). Quo never offers a Claude.ai login of
//     its own, and never collects, stores or passes on a credential or token.
//   - Quo never pays for, resells or sits between the person and Anthropic: usage is the person's own, billed to them.
//   - The feature is named "Claude Agent" (the Agent SDK's branding rules), never "Claude Code".
// Those terms also require Quo's maker to accept Anthropic's Commercial Terms of Service, and Anthropic may enforce its
// rules without notice: IN_RELEASES is the one switch that takes Claude Agent out of released builds again (its code isn't
// started, the page gets no bridge for it, and the SDK isn't packaged; test/claude/release.test.js checks that
// electron-builder.yml agrees).
const IN_RELEASES = true;

/** Whether this build offers Claude Agent: development builds always do; packaged ones while IN_RELEASES is on. */
const claudeAgentOffered = packaged => !packaged || IN_RELEASES;

module.exports = { IN_RELEASES, claudeAgentOffered };
