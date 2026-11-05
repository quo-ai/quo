'use strict';

const crypto = require('node:crypto');
const { PREFIX } = require('./tools');

/**
 * How Claude Code is started for Quo. The page has no say in any of it: it sends only the conversation, the model's
 * name and the tool list. Claude Code runs with none of its own tools, settings, hooks, skills, memory or MCP servers,
 * so the only thing it can do is answer, and ask for one of Quo's tools; Quo's own loop then runs that tool with its
 * usual approvals (apps/desktop/README.md → Claude Agent).
 */

// Claude Code features that Quo has its own version of, or that Quo couldn't show or control.
const TURNED_OFF = {
  CLAUDE_CODE_DISABLE_CLAUDE_MDS: '1',
  CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
  CLAUDE_CODE_ENABLE_AWAY_SUMMARY: '0',
  // All of Quo's tools reach Claude as MCP tools, and tool search would hide every one of them.
  ENABLE_TOOL_SEARCH: 'false',
  CLAUDE_CODE_DISABLE_ADVISOR_TOOL: '1',
  // Quo's own limits on tool output apply instead.
  MAX_MCP_OUTPUT_TOKENS: '200000',
  // Quo decides what the model keeps of a long chat; Claude Code's own summary would change it without Quo knowing.
  DISABLE_AUTO_COMPACT: '1',
  // A stream that breaks is retried without streaming, and the page would wait for a reply that never streams.
  CLAUDE_CODE_DISABLE_NONSTREAMING_FALLBACK: '1',
  // A refused request moves to another model, and the reply would show the wrong model as where it ran.
  CLAUDE_CODE_DISABLE_REFUSAL_FALLBACK: '1',
};

// Set in a person's shell, these would get in the way: the first skips the Claude login, the efforts override the one
// chosen in Quo, the timeout caps every tool call, and approvals can take as long as the person likes.
const CLEARED = ['CLAUDE_CODE_SIMPLE', 'CLAUDE_CODE_EFFORT_LEVEL', 'CLAUDE_EFFORT', 'MCP_TOOL_TIMEOUT'];

// What a running Claude Code session gives the programs it starts (Quo opened from a terminal inside Claude Code, say).
// Passed on, they would make Quo's Claude Code act as part of that session: report that session's program as the one
// asking, stop saving transcripts (so a stopped conversation couldn't be picked up again), use the host's sign-in or
// worktree, and connect to the session's socket or the editor's.
const SESSION_MARKERS = [
  'CLAUDECODE', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_CODE_SESSION_ATTENDED', 'CLAUDE_CODE_BRIDGE_SESSION_ID',
  'CLAUDE_CODE_HOST_AUTH_ENV_VAR', 'CLAUDE_CODE_HOST_WORKTREE', 'CLAUDE_CODE_HOST_WORKTREE_FENCE', 'CLAUDE_CODE_EVAL_INTERVIEW_SESSION',
  'CLAUDE_CODE_CHROME_MCP_ORG_DENIED', 'CLAUDE_BG_GATEWAY_WITHHELD', 'CLAUDE_CODE_FORCE_SESSION_PERSISTENCE', 'CLAUDE_CODE_PLAN_MODE_REQUIRED',
  'CLAUDE_CODE_EXECPATH', 'CLAUDE_CODE_MESSAGING_SOCKET', 'CLAUDE_CODE_MESSAGING_TOKEN', 'CLAUDE_PID', 'CLAUDE_AGENT_SDK_VERSION',
  'CLAUDE_CODE_SSE_PORT', 'CLAUDE_CODE_EMIT_STARTUP_TIMING', 'CLAUDE_CODE_STARTUP_FAILURE_RESULTS', 'CLAUDE_CODE_QUESTION_PREVIEW_FORMAT',
  'CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING', 'CLAUDE_CODE_ENABLE_TASKS',
];

// The program asking, as Claude Code labels every request. Quo's own name, never another program's (`cli` is
// Claude Code in a terminal): the SDK's default, `sdk-ts`, uses up a plan's 5-hour limit about twice as fast for the
// same work (anthropics/claude-code#97074), and an inherited label would name the session that started Quo.
const ENTRYPOINT = 'quo-desktop';

/** The environment Claude Code starts with: the person's own (it holds their login settings and proxy), less Electron's, plus the switches above. */
function childEnv(env, version) {
  const kept = {};
  for (const [name, value] of Object.entries(env)) {
    if (typeof value !== 'string' || /^(ELECTRON_|CHROME_)/.test(name) || name === 'NODE_OPTIONS' || CLEARED.includes(name) || SESSION_MARKERS.includes(name)) continue;
    kept[name] = value;
  }
  // Says honestly which app is asking: in the label on every request, and in its User-Agent (Anthropic's SDK puts the second there).
  return { ...kept, CLAUDE_CODE_ENTRYPOINT: ENTRYPOINT, CLAUDE_AGENT_SDK_CLIENT_APP: `quo-desktop/${version || 'dev'}`, ...TURNED_OFF };
}

/** What every Claude Code process Quo starts has, including the sign-in check. */
function baseOptions({ executable, env, cwd }) {
  return {
    pathToClaudeCodeExecutable: executable,
    cwd,
    env,
    settingSources: [],
    settings: { disableAllHooks: true },
    strictMcpConfig: true,
    skills: [],
    tools: [],
    permissionMode: 'dontAsk',
    allowedTools: [`${PREFIX}*`],
    // Messages go to the model exactly as written: no /commands, @files or added context.
    verbatimPrompts: true,
    persistSession: false,
  };
}

/**
 * A conversation's process: Quo's own system prompt (the same one every model gets), and Quo's tools as the only ones.
 * A conversation's transcript is saved in Claude Code's folder for Quo's working folder, so it can be picked up again
 * after the process stops; sessions.js deletes it once Quo is done with it. Side calls (summaries) save nothing.
 */
function sessionOptions({ base, model, system, server, hooks, effort, persist, resume }) {
  return {
    ...base,
    model,
    systemPrompt: system,
    // Thinking summaries, so the reply shows what the model was thinking.
    thinking: { type: 'adaptive', display: 'summarized' },
    ...(effort ? { effort } : {}),
    includePartialMessages: true,
    hooks,
    mcpServers: server ? { quo: server } : {},
    persistSession: persist,
    ...(resume ? { resume } : persist ? { sessionId: crypto.randomUUID() } : {}),
  };
}

/**
 * The person's Thinking choice as Claude Code's effort: one of its own efforts as it is (when the model takes it), Quick
 * the lowest the model has, Deep the highest short of `max` (which would use up a plan fast), and Auto (or anything the
 * model doesn't take) Claude Code's default.
 */
function effortFor(level, supported = []) {
  if (['low', 'medium', 'high', 'xhigh', 'max'].includes(level)) return supported.includes(level) ? level : null;
  if (level === 'quick') return supported.includes('low') ? 'low' : supported[0] ?? null;
  if (level === 'deep') return ['xhigh', 'high'].find(effort => supported.includes(effort)) ?? null;
  return null;
}

module.exports = { childEnv, baseOptions, sessionOptions, effortFor, TURNED_OFF, CLEARED, SESSION_MARKERS, ENTRYPOINT };
