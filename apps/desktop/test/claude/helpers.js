'use strict';

/**
 * A stand-in for a running Claude Code process (what session.js startSession returns), so the session logic is
 * tested without the SDK or a login. Like the real one, it connects Quo's MCP server, gives each tool call's id to the
 * PreToolUse hook and asks the server to run it, so tools.js is exercised for real.
 *
 * `script(content, state)` is called for each new turn and returns the steps of the reply: { text }, { tool: name, input }
 * or { hang: true } (a reply that never comes).
 */

const TOOL_PREFIX = 'mcp__quo__';

function fakeStart(script, log = []) {
  return async options => {
    const server = options.mcpServers.quo?.instance;
    const waitingReplies = new Map();
    let nextId = 0;
    const transport = {
      async start() {},
      async send(message) {
        waitingReplies.get(message.id)?.(message);
      },
    };
    const rpc = (method, params) => new Promise(resolve => {
      const id = ++nextId;
      waitingReplies.set(id, resolve);
      transport.onmessage({ jsonrpc: '2.0', id, method, params });
    });
    if (server) {
      await server.connect(transport);
      await rpc('initialize', { protocolVersion: '2025-06-18' });
    }
    const hook = options.hooks.PreToolUse[0].hooks[0];
    let queue = [];
    let wake = null;
    let ended = false;
    let calls = 0;
    const state = { options, turns: [], added: [] };
    const push = message => {
      queue.push(message);
      wake?.();
    };
    const stream = (type, extra = {}) => push({ type: 'stream_event', parent_tool_use_id: null, event: { type, ...extra } });

    let cancelled = false;
    async function play(steps) {
      cancelled = false;
      for (const step of steps) {
        if (step.hang || cancelled) return; // never answers, until stopped
        stream('message_start', { message: { usage: { input_tokens: 10, output_tokens: 0 } } });
        if (step.text) {
          stream('content_block_start');
          stream('content_block_delta', { delta: { type: 'text_delta', text: step.text } });
          push({ type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'text', text: step.text }] } });
          stream('message_delta', { usage: { output_tokens: 5 } });
          stream('message_stop');
          continue;
        }
        const id = `toolu_${++calls}`;
        const name = TOOL_PREFIX + step.tool;
        push({ type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', id, name, input: step.input ?? {} }] } });
        stream('message_stop');
        if (!server) continue;
        await hook({ hook_event_name: 'PreToolUse', tool_use_id: id, tool_name: name });
        const answer = await rpc('tools/call', { name: step.tool, arguments: step.input ?? {} });
        log.push({ tool: step.tool, answer });
        if (cancelled) return;
      }
      push({ type: 'result', subtype: 'success', is_error: false, result: '' });
    }
    let turnOpen = false;
    let reading = false;

    const efforts = ['low', 'medium', 'high', 'xhigh', 'max'];
    return {
      id: options.resume ?? options.sessionId ?? null,
      ready: options.resume === 'missing'
        ? Promise.reject(new Error('No conversation found with that session ID.'))
        : Promise.resolve({ claude_code_version: '2.1.300', models: [{ value: 'sonnet', supportedEffortLevels: efforts }, { value: 'opus', supportedEffortLevels: efforts }] }),
      get ended() {
        return ended;
      },
      state,
      begin(content) {
        state.turns.push(content);
        turnOpen = true;
        void play(script(content, state));
      },
      async interrupt() {
        if (!turnOpen) return;
        cancelled = true;
        log.push({ interrupted: true });
        // Like the real one, the stopped turn's result belongs to that turn: it reaches a reader only if one is waiting.
        if (reading) push({ type: 'result', subtype: 'error_during_execution', is_error: true, result: '', errors: ['Interrupted'] });
        else turnOpen = false;
      },
      async setEffort(effort) {
        log.push({ effort });
      },
      async setThinkingOff(off) {
        log.push({ thinkingOff: off });
      },
      addUser(content) {
        state.added.push(content);
      },
      async readStep(emit, tools) {
        let called = false;
        reading = true;
        try {
          while (true) {
            const message = queue.shift();
            if (!message) {
              if (ended) throw new Error('Claude Code stopped before it finished its reply.');
              await new Promise(resolve => {
                wake = resolve;
              });
              wake = null;
              continue;
            }
            emit(message);
            if (message.type === 'assistant' && message.message.content.some(part => part.type === 'tool_use' && tools.some(tool => TOOL_PREFIX + tool.name === part.name))) called = true;
            if (called && message.type === 'stream_event' && message.event.type === 'message_stop') return 'tools';
            if (message.type === 'result') {
              turnOpen = false;
              return message;
            }
          }
        } finally {
          reading = false;
        }
      },
      async setModel(model) {
        log.push({ setModel: model });
      },
      async stop() {
        ended = true;
        queue = [];
        wake?.();
        log.push({ stopped: true });
      },
    };
  };
}

const base = () => ({ pathToClaudeCodeExecutable: '/usr/bin/claude', cwd: '/tmp', env: {} });
const tool = (name, extra = {}) => ({ name, description: `The ${name} tool.`, parameters: { type: 'object', properties: {} }, ...extra });
const echoOf = reply => ({ role: 'assistant', content: reply.content, ...(reply.toolCalls.length ? { tool_calls: reply.toolCalls.map(call => ({ id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments } })) } : {}) });

module.exports = { fakeStart, base, tool, echoOf, TOOL_PREFIX };
