'use strict';

const crypto = require('node:crypto');
const { offered } = require('./tools');
const { loadSdk } = require('./sdk');

/**
 * One running `claude` process holding one conversation, driven through Anthropic's Agent SDK. Messages go in through
 * a queue the SDK reads; everything Claude Code says comes out of one reader, and each step of a turn is read from it.
 */

// Older versions ignore verbatimPrompts, and could treat a message as one of Claude Code's own commands.
const MINIMUM_VERSION = '2.1.248';

/** Compares release numbers like 2.1.248, ignoring any pre-release or build suffix. */
function atLeast(version, minimum) {
  const parse = value => value.split(/[-+]/)[0].split('.').map(Number);
  const current = parse(version);
  const required = parse(minimum);
  const at = required.findIndex((part, i) => (current[i] ?? 0) !== part);
  return at === -1 || (current[at] ?? 0) > required[at];
}

function versionProblem(version) {
  if (version && atLeast(version, MINIMUM_VERSION)) return null;
  return version ? `Claude Code ${version} is too old for Quo; ${MINIMUM_VERSION} or later is needed. Run \`claude update\` in a terminal.` : 'Claude Code didn’t say which version it is. Run `claude update` in a terminal.';
}

function inputQueue() {
  const items = [];
  let wake = null;
  let closed = false;
  return {
    push(item) {
      items.push(item);
      wake?.();
    },
    close() {
      closed = true;
      wake?.();
    },
    async *[Symbol.asyncIterator]() {
      while (true) {
        if (items.length) {
          yield items.shift();
          continue;
        }
        if (closed) return;
        await new Promise(resolve => {
          wake = resolve;
        });
        wake = null;
      }
    },
  };
}

async function startSession(options, { load = loadSdk } = {}) {
  const { query } = await load();
  const input = inputQueue();
  const session = query({ prompt: input, options });
  let turn = null;
  let ended = false;
  let failure = null;
  let stopping = null;

  const ready = session.initializationResult().then(init => {
    const problem = versionProblem(init.claude_code_version);
    if (problem) throw new Error(problem);
    return init;
  });
  ready.catch(() => {});

  const finishTurn = () => {
    if (!turn || turn.finished) return;
    turn.finished = true;
    turn.drained();
  };

  // The only reader of what Claude Code says, including while a turn is being stopped.
  const pump = (async () => {
    try {
      for await (const message of session) {
        if (turn) {
          turn.messages.push(message);
          turn.wake?.();
        }
        if (message.type === 'result') finishTurn();
      }
    } catch (error) {
      failure = error;
    } finally {
      ended = true;
      finishTurn();
      turn?.wake?.();
    }
  })();

  const send = (content, extra = {}) => input.push({ type: 'user', uuid: crypto.randomUUID(), session_id: '', message: { role: 'user', content }, parent_tool_use_id: null, ...extra });

  return {
    id: options.resume ?? options.sessionId ?? null,
    ready,
    get ended() {
      return ended;
    },
    /** Starts a turn with a message. */
    begin(content) {
      if (ended || stopping) throw failure ?? new Error('Claude Code has stopped.');
      if (turn && !turn.finished) throw new Error('Claude Code is still finishing its last reply.');
      let drained;
      const done = new Promise(resolve => {
        drained = resolve;
      });
      turn = { messages: [], finished: false, drained, done, wake: null };
      send(content);
    },
    /** Adds the person's message to the turn that is running (it is read after the tool results). */
    addUser(content) {
      send(content, { priority: 'next' });
    },
    /** Reads until the reply asks for Quo's tools ('tools') or the turn ends (its result message). */
    async readStep(emit, tools) {
      const active = turn;
      if (!active) throw new Error('There is no reply to read.');
      let calledTools = false;
      while (true) {
        const message = active.messages.shift();
        if (!message) {
          if (ended) throw failure ?? new Error('Claude Code stopped before it finished its reply.');
          await new Promise(resolve => {
            active.wake = resolve;
          });
          continue;
        }
        emit(message);
        if (message.type === 'assistant' && message.parent_tool_use_id === null) {
          // Calls to tools Quo didn't offer get Claude Code's own error, and the turn goes on without Quo.
          if (message.message.content.some(part => part.type === 'tool_use' && offered(part.name, tools))) calledTools = true;
        }
        const replyEnded = message.type === 'stream_event' && message.parent_tool_use_id === null && message.event?.type === 'message_stop';
        if (calledTools && replyEnded) return 'tools';
        if (message.type === 'result') return message;
      }
    },
    setModel: model => session.setModel(model),
    setEffort: effort => session.applyFlagSettings({ effortLevel: effort ?? null }),
    /** No thinking, or back to the thinking the process started with (adaptive, with summaries). */
    setThinkingOff: off => session.setMaxThinkingTokens(off ? 0 : null, off ? null : 'summarized'),
    /** Stops the turn that is running and waits for Claude Code to finish writing it down; the process carries on. */
    async interrupt() {
      const active = turn;
      if (!active || active.finished || ended) return;
      await session.interrupt();
      await active.done;
    },
    stop() {
      stopping ??= (async () => {
        input.close();
        session.close();
        await Promise.race([pump, new Promise(resolve => setTimeout(resolve, 5000).unref?.())]);
      })();
      return stopping;
    },
  };
}

module.exports = { startSession, versionProblem, atLeast, MINIMUM_VERSION };
