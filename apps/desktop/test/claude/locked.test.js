'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { baseOptions, childEnv, sessionOptions } = require('../../src/claude/options');
const { findClaude } = require('../../src/claude/locate');
const { accountOf } = require('../../src/claude/status');
const { atLeast, versionProblem } = require('../../src/claude/session');

test('Claude Code starts with none of its own tools, settings, hooks, skills or MCP servers', () => {
  const options = baseOptions({ executable: '/usr/bin/claude', env: {}, cwd: '/tmp/quo' });
  assert.deepEqual(options.tools, []);
  assert.deepEqual(options.settingSources, []);
  assert.deepEqual(options.skills, []);
  assert.equal(options.permissionMode, 'dontAsk');
  assert.deepEqual(options.allowedTools, ['mcp__quo__*']);
  assert.equal(options.strictMcpConfig, true);
  assert.equal(options.settings.disableAllHooks, true);
  assert.equal(options.verbatimPrompts, true);
  assert.equal(options.persistSession, false);
  // Nothing that would let Claude Code act without asking, or skip its permission rules.
  assert.equal(options.allowDangerouslySkipPermissions, undefined);
  const session = sessionOptions({ base: options, model: 'sonnet', system: 'Quo’s prompt', server: null, hooks: {} });
  assert.deepEqual(session.mcpServers, {});
  assert.equal(session.systemPrompt, 'Quo’s prompt');
  assert.equal(session.permissionMode, 'dontAsk');
});

test('its environment is the person’s own, less Electron’s and the settings that would get in the way', () => {
  const env = childEnv({ HOME: '/home/a', PATH: '/usr/bin', HTTPS_PROXY: 'http://proxy:3128', ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '--require /tmp/x.js', CLAUDE_CODE_SIMPLE: '1', MCP_TOOL_TIMEOUT: '10', CLAUDE_CODE_EFFORT_LEVEL: 'max' }, '1.6.0');
  assert.equal(env.HOME, '/home/a');
  assert.equal(env.HTTPS_PROXY, 'http://proxy:3128');
  for (const gone of ['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'CLAUDE_CODE_SIMPLE', 'MCP_TOOL_TIMEOUT', 'CLAUDE_CODE_EFFORT_LEVEL']) assert.equal(gone in env, false, gone);
  assert.equal(env.CLAUDE_CODE_DISABLE_AUTO_MEMORY, '1');
  assert.equal(env.CLAUDE_CODE_DISABLE_CLAUDE_MDS, '1');
  assert.equal(env.ENABLE_TOOL_SEARCH, 'false');
  assert.equal(env.CLAUDE_AGENT_SDK_CLIENT_APP, 'quo-desktop/1.6.0');
});

test('only the person’s own claude is found: never through a relative PATH entry, and a chosen one must be absolute', () => {
  const at = new Set(['/home/a/.local/bin/claude', '/abs/claude', path.resolve('bin', 'claude')]);
  const executable = file => at.has(file);
  assert.equal(findClaude({ env: { PATH: 'bin:.' }, platform: 'linux', home: '/home/a', executable }), '/home/a/.local/bin/claude');
  assert.equal(findClaude({ env: { PATH: '' }, platform: 'linux', home: '/nobody', executable }), null);
  assert.equal(findClaude({ env: { QUO_CLAUDE_PATH: 'claude' }, platform: 'linux', home: '/home/a', executable }), null);
  assert.equal(findClaude({ env: { QUO_CLAUDE_PATH: '/abs/claude' }, platform: 'linux', home: '/home/a', executable }), '/abs/claude');
});

test('the page learns how Claude Code is signed in, never the email or organization', () => {
  const account = accountOf({ email: 'someone@example.com', organization: 'Org', subscriptionType: 'Claude Pro', apiProvider: 'firstParty' });
  assert.deepEqual(account, { signedIn: true, kind: 'subscription', plan: 'Claude Pro' });
  assert.equal(JSON.stringify(account).includes('example.com'), false);
  assert.deepEqual(accountOf({ apiProvider: 'firstParty' }), { signedIn: false, kind: null, plan: null });
  assert.deepEqual(accountOf({ tokenSource: 'none' }), { signedIn: false, kind: null, plan: null });
  assert.equal(accountOf({ apiKeySource: 'ANTHROPIC_API_KEY' }).kind, 'api_key');
  assert.equal(accountOf({ apiProvider: 'bedrock' }).kind, 'cloud');
});

test('Claude Code that is too old (it would ignore verbatim messages) is refused', () => {
  assert.equal(atLeast('2.1.300', '2.1.248'), true);
  assert.equal(atLeast('2.1.248-beta', '2.1.248'), true);
  assert.equal(atLeast('2.0.999', '2.1.248'), false);
  assert.match(versionProblem('2.1.100'), /too old/);
  assert.match(versionProblem(undefined), /didn’t say/);
  assert.equal(versionProblem('3.0.0'), null);
});

test('plan limits: a warning says how much is used and when it resets; a refusal says which limit', async () => {
  const { limitText, readReply } = require('../../src/claude/turn');
  const now = Date.parse('2026-11-02T12:00:00Z');
  const soon = (now + 2 * 3_600_000) / 1000;
  assert.match(limitText({ status: 'allowed_warning', rateLimitType: 'five_hour', utilization: 0.8, resetsAt: soon }, now), /^You’ve used 80% of your Claude plan’s 5-hour limit\. It resets at /);
  assert.match(limitText({ status: 'rejected', rateLimitType: 'seven_day', resetsAt: (now + 3 * 86_400_000) / 1000 }, now), /^You’ve reached your Claude plan’s weekly limit\. It resets on \w+ at /);
  assert.equal(limitText({ status: 'allowed', utilization: 0.1 }, now), null);
  const refused = {
    async readStep(emit) {
      emit({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', rateLimitType: 'five_hour' } });
      emit({ type: 'assistant', parent_tool_use_id: null, error: 'rate_limit', message: { content: [{ type: 'text', text: 'limit reached' }] } });
      return { type: 'result', subtype: 'success', is_error: true, result: 'limit reached' };
    },
  };
  await assert.rejects(readReply(refused, { tools: [], pending: null, onUpdate: () => {} }), error => error.code === 'claude_limit' && /5-hour limit/.test(error.message));
  const warned = {
    async readStep(emit) {
      emit({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed_warning', rateLimitType: 'seven_day', utilization: 91 } });
      emit({ type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'text', text: 'Hi.' }] } });
      return { type: 'result', subtype: 'success', is_error: false, result: 'Hi.' };
    },
  };
  const reply = await readReply(warned, { tools: [], pending: null, onUpdate: () => {} });
  assert.equal(reply.content, 'Hi.');
  assert.match(reply.notice, /^You’ve used 91% of your Claude plan’s weekly limit\./);
});

test('Thinking: Quick is the lowest effort, Deep the highest short of max, Auto leaves it to Claude Code', () => {
  const { effortFor } = require('../../src/claude/options');
  const all = ['low', 'medium', 'high', 'xhigh', 'max'];
  assert.equal(effortFor('quick', all), 'low');
  assert.equal(effortFor('deep', all), 'xhigh');
  assert.equal(effortFor('deep', ['low', 'medium', 'high', 'max']), 'high');
  assert.equal(effortFor('auto', all), null);
  assert.equal(effortFor('deep', []), null);
});

test('models: Claude Code’s own rows at once, then the specific versions it accepts, checked in the background and kept', async () => {
  const { checkClaude } = require('../../src/claude/status');
  const { ModelCatalog } = require('../../src/claude/catalog');
  const accepted = new Map([['default', 1_000_000], ['haiku', 200_000], ['claude-opus-5-5', 1_000_000], ['claude-haiku-4-5', 200_000]]);
  let current = 'default';
  let started = 0;
  const sent = [];
  const load = async () => ({
    query: ({ prompt }) => {
      started++;
      void (async () => { for await (const message of prompt) sent.push(message); })();
      return {
        initializationResult: async () => ({
          claude_code_version: '2.1.300',
          account: { email: 'someone@example.com', subscriptionType: 'Claude Max' },
          models: [
            { value: 'haiku', displayName: 'Haiku', description: 'Haiku 5.5 · Fastest', supportsEffort: false },
            { value: 'default', displayName: 'Default', description: 'Opus 5.5 · Best for everyday, complex tasks', resolvedModel: 'claude-opus-5-5', supportsEffort: true, supportedEffortLevels: ['low', 'high'] },
          ],
        }),
        setModel: async model => {
          if (!accepted.has(model)) throw new Error(`Model '${model}' not found`);
          current = model;
        },
        getContextUsage: async () => ({ rawMaxTokens: accepted.get(current) }),
        close() {},
      };
    },
  });
  const catalog = new ModelCatalog();
  const first = await checkClaude({ executable: '/usr/bin/claude', options: {}, load, catalog });
  assert.equal(first.checking, true);
  assert.deepEqual(first.models.map(model => model.id), ['default', 'haiku'], 'its own rows, default first');
  assert.equal(JSON.stringify(first).includes('example.com'), false);
  const full = await catalog.pending();
  assert.deepEqual(full.map(model => [model.id, model.name, model.contextTokens, model.pinned, model.thinking.efforts.length, model.thinking.default]), [
    ['default', 'Default', 1_000_000, false, 2, 'medium'],
    ['haiku', 'Haiku', 200_000, false, 0, null],
    ['claude-opus-5-5', 'Claude Opus 5.5', 1_000_000, true, 2, 'medium'],
    ['claude-haiku-4-5', 'Claude Haiku 4.5', 200_000, true, 0, null],
  ]);
  assert.equal(full[2].description, 'Best for everyday, complex tasks');
  const again = await checkClaude({ executable: '/usr/bin/claude', options: {}, load, catalog });
  assert.equal(again.checking, undefined);
  assert.equal(again.models.length, 4, 'kept: no second check');
  assert.equal(started, 3);
  assert.deepEqual(sent, [], 'no message is ever sent');
});

test('model names, and how each model thinks under Claude Code', () => {
  const { nameOf, thinkingOf } = require('../../src/claude/models');
  assert.equal(nameOf('claude-opus-5-5'), 'Claude Opus 5.5');
  assert.equal(nameOf('claude-fable-5'), 'Claude Fable 5');
  assert.equal(nameOf('opus[1m]'), 'opus[1m]');
  assert.deepEqual(thinkingOf('claude-opus-5-5'), { efforts: ['low', 'medium', 'high', 'xhigh', 'max'], default: 'medium', off: false });
  assert.deepEqual(thinkingOf('claude-opus-4-7'), { efforts: ['low', 'medium', 'high', 'xhigh', 'max'], default: 'xhigh', off: true });
  assert.deepEqual(thinkingOf('claude-opus-4-5').efforts, ['low', 'medium', 'high']);
  assert.deepEqual(thinkingOf('claude-haiku-4-5').efforts, []);
  // A short name takes the facts of the model it stands for; Claude Code's own efforts win.
  const rows = [{ value: 'sonnet', resolvedModel: 'claude-sonnet-5-5', supportedEffortLevels: ['low', 'high'] }];
  assert.deepEqual(thinkingOf('sonnet', rows), { efforts: ['low', 'high'], default: 'medium', off: false });
  assert.deepEqual(thinkingOf('claude-x-9', [{ value: 'default', resolvedModel: 'claude-x-9', supportedEffortLevels: ['high'] }]), { efforts: ['high'], default: null, off: false });
  assert.deepEqual(thinkingOf('opus', [{ value: 'opus', supportsEffort: false }]).efforts, []);
});

test('plan usage: each window’s share used and reset time, from Claude Code’s report', () => {
  const { planOf } = require('../../src/claude/turn');
  const plan = planOf({ status: 'allowed', resetsAt: 1793653200, rateLimitType: 'five_hour', overageStatus: 'rejected', isUsingOverage: false, unifiedWindows: { five_hour: { utilization: 0.24, resetsAt: 1793653200 }, seven_day: { utilization: 0.45, resetsAt: 1793818800 }, 'bad key!': { utilization: 0.9 } } });
  assert.deepEqual(plan, { status: 'allowed', windows: [{ id: 'five_hour', used: 24, resetsAt: 1793653200000 }, { id: 'seven_day', used: 45, resetsAt: 1793818800000 }], extra: 'off' });
  assert.deepEqual(planOf({ status: 'allowed_warning', rateLimitType: 'seven_day', utilization: 91 }).windows, [{ id: 'seven_day', used: 91, resetsAt: null }]);
  assert.equal(planOf({ status: 'allowed' }), null);
  assert.equal(planOf(null), null);
});

test('Thinking: Claude Code’s own efforts go through as they are, only where the model takes them', () => {
  const { effortFor } = require('../../src/claude/options');
  const { checkRequest } = require('../../src/claude/validate');
  assert.equal(effortFor('max', ['low', 'high', 'max']), 'max');
  assert.equal(effortFor('xhigh', ['low', 'medium', 'high', 'max']), null);
  assert.equal(checkRequest({ id: 'request-0001', model: 'opus', messages: [{ role: 'user', content: 'hi' }], effort: 'xhigh' }).effort, 'xhigh');
  assert.throws(() => checkRequest({ id: 'request-0001', model: 'opus', messages: [{ role: 'user', content: 'hi' }], effort: 'ultra' }), error => error.code === 'bad_request');
});
