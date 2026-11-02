'use strict';

/**
 * Quo's tools as Claude Code sees them: an MCP server inside this process, named `quo`. It runs nothing. When Claude
 * calls a tool, the call is held here and handed back to the page as the model's answer; the page runs it through
 * Code mode's own tools and approvals (apps/desktop/src/agent/), and the result comes back with the next request.
 */

const PREFIX = 'mcp__quo__';
// Claude Code cuts each MCP tool description at this many characters.
const DESCRIPTION_LIMIT = 2048;

/**
 * Tool calls waiting for their results. Claude Code says which call is starting (the PreToolUse hook gives its id)
 * just before it asks the server to run it, so tools are marked as changing things: then it runs them one at a time,
 * and the id the hook gave is always the one the server is asked for.
 */
class PendingTools {
  constructor() {
    this.calls = new Map();
    this.next = null;
  }

  /** A call the model made, to be answered later. */
  expect(id, name) {
    let call = this.calls.get(id);
    if (!call) {
      let resolve;
      const result = new Promise(r => {
        resolve = r;
      });
      call = { name, result, resolve };
      this.calls.set(id, call);
    }
    if (call.name !== name) throw new Error('Claude Code mixed up two tool calls.');
    return call;
  }

  before(id, name) {
    this.expect(id, name);
    this.next = id;
  }

  async call(name) {
    const id = this.next;
    this.next = null;
    if (!id) throw new Error('Claude Code called a tool without saying which call it was.');
    const result = await this.expect(id, name).result;
    this.calls.delete(id);
    return result;
  }

  resolve(id, text, isError = false) {
    const call = this.calls.get(id);
    if (!call) throw new Error('No tool call is waiting with that id.');
    call.resolve({ content: [{ type: 'text', text: text || '(no output)' }], isError });
  }

  /** Answers every waiting call as stopped. Only once the turn is interrupted, or Claude would carry on with it. */
  clear() {
    for (const call of this.calls.values()) call.resolve({ content: [{ type: 'text', text: 'Stopped by the user.' }], isError: true });
    this.calls.clear();
    this.next = null;
  }
}

/** The name Claude sees for a tool the page offered, or undefined for any other. */
const offered = (fullName, tools) => tools.find(tool => PREFIX + tool.name === fullName)?.name;

/** A minimal MCP server over the SDK's in-process transport: it lists the tools and holds each call until its result comes. */
function toolServer(tools, pending) {
  const definitions = tools.map(tool => ({
    name: tool.name,
    description: tool.description.slice(0, DESCRIPTION_LIMIT),
    inputSchema: tool.parameters,
    annotations: { readOnlyHint: false },
    _meta: { 'anthropic/alwaysLoad': true, 'anthropic/maxResultSizeChars': 500_000 },
  }));
  const instance = {
    async connect(transport) {
      const reply = (id, body) => transport.send({ jsonrpc: '2.0', id, ...body }).catch(() => {});
      transport.onmessage = async message => {
        if (!message || typeof message.method !== 'string' || !('id' in message)) return; // notifications need no answer
        const { id, method, params } = message;
        try {
          if (method === 'initialize') reply(id, { result: { protocolVersion: params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'quo', version: '1.0.0' } } });
          else if (method === 'ping') reply(id, { result: {} });
          else if (method === 'tools/list') reply(id, { result: { tools: definitions } });
          else if (method === 'tools/call') {
            const name = PREFIX + String(params?.name ?? '');
            if (!offered(name, tools)) return reply(id, { error: { code: -32602, message: 'Unknown tool.' } });
            reply(id, { result: await pending.call(name) });
          } else reply(id, { error: { code: -32601, message: 'Method not found.' } });
        } catch (error) {
          reply(id, { error: { code: -32603, message: error.message } });
        }
      };
      await transport.start?.();
    },
    async close() {},
  };
  return { type: 'sdk', name: 'quo', instance };
}

/** Claude Code's hook that gives the id of each tool call just before it is run. */
function toolHooks(pending) {
  const before = async input => {
    if (input?.hook_event_name === 'PreToolUse' && typeof input.tool_name === 'string' && input.tool_name.startsWith(PREFIX)) pending.before(input.tool_use_id, input.tool_name);
    return {};
  };
  return { PreToolUse: [{ hooks: [before] }] };
}

module.exports = { PREFIX, PendingTools, offered, toolServer, toolHooks };
