'use strict';

const { offered } = require('./tools');

/**
 * One step of Claude's turn as a provider reply, the same shape every other model gives the page: the words so far
 * as they stream, then the finished words, thinking, tool calls and token counts.
 */

class ClaudeError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const SIGN_IN = 'Claude Code isn’t signed in. Run `claude auth login` in a terminal, then try again.';
const PROBLEMS = {
  authentication_failed: SIGN_IN,
  oauth_org_not_allowed: 'Your Claude organization doesn’t allow this sign-in.',
  account_on_hold: 'Your Claude account is on hold.',
  verification_required: 'Claude needs you to verify your account. Open Claude Code in a terminal to do it.',
  billing_error: 'Your Claude plan can’t be used right now.',
  rate_limit: 'You’ve reached your Claude plan’s limit for now.',
  overloaded: 'Claude is busy right now. Try again in a moment.',
  model_not_found: 'Claude Code doesn’t offer that model. Pick another in Models & storage → Your keys → Claude Agent.',
};

const textOf = message => (message?.message?.content ?? []).filter(part => part.type === 'text').map(part => part.text).join(' ').trim();

const WINDOWS = { five_hour: '5-hour', seven_day: 'weekly', seven_day_opus: 'weekly Opus', seven_day_sonnet: 'weekly Sonnet', seven_day_overage_included: 'weekly', overage: 'extra usage' };

/** When a plan limit resets, in the person's own words for time: "at 3:40 PM", or "on Friday at 9:00 AM". */
function resetText(resetsAt, now = Date.now()) {
  if (typeof resetsAt !== 'number' || !Number.isFinite(resetsAt)) return '';
  const at = new Date(resetsAt < 1e12 ? resetsAt * 1000 : resetsAt);
  const time = at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return at.getTime() - now < 20 * 3_600_000 ? ` It resets at ${time}.` : ` It resets on ${at.toLocaleDateString(undefined, { weekday: 'long' })} at ${time}.`;
}

const percent = value => (typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value <= 1 ? value * 100 : value))) : null);
const msOf = at => (typeof at === 'number' && Number.isFinite(at) ? (at < 1e12 ? at * 1000 : at) : null);

/**
 * The plan's usage windows from Claude Code's report (subscriptions only): how much of each is used and when it resets
 * ("five_hour", "seven_day", and per-model weekly windows on plans that have them), and whether extra usage is on.
 */
function planOf(info) {
  if (!info) return null;
  const windows = [];
  const unified = info.unifiedWindows && typeof info.unifiedWindows === 'object' ? info.unifiedWindows : {};
  for (const [id, window] of Object.entries(unified).slice(0, 8)) {
    const used = percent(window?.utilization);
    if (/^[a-z_]{1,40}$/.test(id) && used !== null) windows.push({ id, used, resetsAt: msOf(window.resetsAt) });
  }
  // Older versions report only the window closest to its limit.
  if (!windows.length && typeof info.rateLimitType === 'string' && percent(info.utilization) !== null) windows.push({ id: info.rateLimitType, used: percent(info.utilization), resetsAt: msOf(info.resetsAt) });
  const extra = info.isUsingOverage ? 'in_use' : info.overageStatus === 'allowed' || info.overageStatus === 'allowed_warning' ? 'available' : info.overageStatus === 'rejected' ? 'off' : null;
  return windows.length || extra ? { status: typeof info.status === 'string' ? info.status : null, windows, extra } : null;
}

/**
 * What Claude Code reports about the person's plan limits (subscriptions only), as a line to show: a warning when a
 * limit is close, or why a reply was refused. Null when there is nothing to say.
 */
function limitText(info, now = Date.now()) {
  // Past a plan limit with usage credits on, Claude carries on and Anthropic bills each reply: say so the moment it starts.
  if (info?.isUsingOverage === true && info.status !== 'rejected') return 'You’ve reached your Claude plan’s limit, so replies now use your usage credits, which Anthropic bills at API rates.';
  if (!info || (info.status !== 'allowed_warning' && info.status !== 'rejected')) return null;
  const window = WINDOWS[info.rateLimitType] ?? '';
  const limit = `your Claude plan’s ${window ? `${window} ` : ''}limit`;
  if (info.status === 'rejected') return `You’ve reached ${limit}.${resetText(info.resetsAt, now)}`;
  const used = typeof info.utilization === 'number' ? Math.round(info.utilization <= 1 ? info.utilization * 100 : info.utilization) : null;
  return `${used ? `You’ve used ${used}% of ${limit}` : `You’re close to ${limit}`}.${resetText(info.resetsAt, now)}`;
}

/** What went wrong, in words the person can act on, with Claude's own words where they help. */
function problemFor(kind, detail) {
  const said = String(detail ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
  if (kind === 'authentication_failed' || /not logged in|please run \/login|invalid api key/i.test(said)) return new ClaudeError('claude_auth', SIGN_IN);
  const known = PROBLEMS[kind];
  if (known) return new ClaudeError(kind === 'rate_limit' ? 'claude_limit' : 'claude_failed', said && !said.startsWith(known) ? `${known} Claude said: ${said}` : known);
  return new ClaudeError('claude_failed', said ? `Claude Code couldn’t answer: ${said}` : 'Claude Code couldn’t answer.');
}

async function readReply(session, { tools, pending, onUpdate, intervalMs = 50 }) {
  const reply = { content: '', reasoning: '', toolCalls: [], finish: null, usage: null };
  const texts = [];
  let thinking = '';
  let partText = '';
  let partThinking = '';
  let usage = { input: 0, output: 0 };
  let failure = null;
  let limit = null;
  let model = null;
  let timer = null;
  const show = () => onUpdate({ content: [...texts, partText].filter(Boolean).join('\n\n'), reasoning: thinking + partThinking });
  const soon = () => {
    timer ??= setTimeout(() => {
      timer = null;
      show();
    }, intervalMs);
  };

  const emit = message => {
    if (message.type === 'system' && message.subtype === 'init' && tools.length && !message.mcp_servers?.some(server => server.name === 'quo' && server.status === 'connected')) {
      throw new ClaudeError('claude_failed', 'Quo’s tools didn’t connect to Claude Code.');
    }
    if (message.type === 'rate_limit_event') limit = message.rate_limit_info ?? null;
    if (message.parent_tool_use_id !== null) return;
    if (message.type === 'stream_event') {
      const event = message.event ?? {};
      if (event.type === 'message_start') {
        const counts = event.message?.usage ?? {};
        usage = { input: (counts.input_tokens ?? 0) + (counts.cache_creation_input_tokens ?? 0) + (counts.cache_read_input_tokens ?? 0), output: counts.output_tokens ?? 0 };
      } else if (event.type === 'content_block_start') {
        partText = '';
        partThinking = '';
      } else if (event.type === 'content_block_delta') {
        if (event.delta?.type === 'text_delta') partText += event.delta.text ?? '';
        else if (event.delta?.type === 'thinking_delta') partThinking += event.delta.thinking ?? '';
        soon();
      } else if (event.type === 'message_delta' && typeof event.usage?.output_tokens === 'number') usage.output = event.usage.output_tokens;
    } else if (message.type === 'assistant') {
      // The exact model that answered: "claude-sonnet-5-5" for the short name "sonnet".
      if (typeof message.message?.model === 'string' && /^[\w.:\[\]-]{1,80}$/.test(message.message.model)) model = message.message.model;
      if (message.error) failure = { kind: message.error, detail: textOf(message) };
      else {
        for (const part of message.message?.content ?? []) {
          if (part.type === 'text' && part.text) texts.push(part.text);
          else if (part.type === 'thinking' && part.thinking) thinking += `${thinking ? '\n\n' : ''}${part.thinking}`;
          else if (part.type === 'tool_use') {
            const name = offered(part.name, tools);
            if (!name) continue;
            pending.expect(part.id, part.name);
            reply.toolCalls.push({ id: part.id, name, arguments: JSON.stringify(part.input ?? {}) });
          }
        }
      }
      partText = '';
      partThinking = '';
      soon();
    }
  };

  try {
    const outcome = await session.readStep(emit, tools);
    if (outcome !== 'tools' && (outcome.is_error || outcome.subtype !== 'success' || failure)) {
      if (limit?.status === 'rejected') throw new ClaudeError('claude_limit', limitText(limit));
      throw problemFor(failure?.kind, failure?.detail || outcome.result || (outcome.errors ?? []).join(' '));
    }
    reply.finish = outcome === 'tools' ? 'tool_calls' : 'stop';
  } finally {
    clearTimeout(timer);
  }
  reply.content = texts.join('\n\n');
  reply.reasoning = thinking;
  reply.usage = usage.input || usage.output ? usage : null;
  const notice = limitText(limit);
  if (notice) reply.notice = notice;
  if (model) reply.model = model;
  const plan = planOf(limit);
  if (plan) reply.plan = plan;
  return reply;
}

module.exports = { readReply, problemFor, limitText, planOf, ClaudeError, SIGN_IN };
