'use strict';

// Before a tool server's tool runs, the person is asked, in Quo's approval window (never anything in the page), unless
// they allowed that tool for this session or chat, or chose the "all" level for a Code session (agent/autonomy.js). The
// "risky" level still asks: what a tool server does is unknown to Quo. Used by Code sessions and chats without a folder.

const { needsAsking } = require('../agent/autonomy');

const ARGS_CHARS = 4000;

/**
 * @param {{ mcp: import('./manager').McpManager | null, name: string, args: object, signal?: AbortSignal, approve: (request: object) => Promise<string>, allowed: Set<string>, level?: string, project?: string, maxChars?: number, rememberLabel?: (tool: string) => string }} options
 */
async function callWithApproval({ mcp, name, args, signal, approve, allowed, level = 'ask', project = '', maxChars, rememberLabel = tool => `Allow ${tool} for this session` }) {
  const known = mcp?.describe(name);
  if (!known) return { ok: false, text: `There’s no tool called ${name}. The tool server may have been turned off.`, display: { kind: 'error', code: 'unknown_tool' } };
  if (!allowed.has(name) && needsAsking(level, 'tool')) {
    const json = JSON.stringify(args, null, 2) ?? '{}';
    const shown = json.length > ARGS_CHARS ? `${json.slice(0, ARGS_CHARS)}…` : json;
    const answer = await approve({
      kind: 'tool',
      title: `Use ${known.tool} from ${known.server}?`,
      detail: `The tool server “${known.server}”, which you added, does this on your computer. What it returns goes to the model.\n\n${shown}`,
      project,
      view: { kind: 'tool', server: known.server, tool: known.tool, args: shown },
      rememberLabel: rememberLabel(known.tool),
    });
    if (answer !== 'once' && answer !== 'session') {
      return { ok: false, text: 'The user didn’t allow that tool. Don’t try it again; ask what they’d like instead.', display: { kind: 'tool', server: known.server, tool: known.tool, denied: true } };
    }
    if (answer === 'session') allowed.add(name);
  }
  return mcp.call(name, args, { signal, ...(maxChars ? { maxChars } : {}) });
}

module.exports = { callWithApproval };
