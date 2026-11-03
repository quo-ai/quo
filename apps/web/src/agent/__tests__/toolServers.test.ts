// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_TOOL_SERVER_TOOLS, toolServerDefinitions, toolServerTools } from '../../../shared/agentTools';
import { describeDone, describeRunning } from '../describe';
import { COMPACT_TOOL_SERVER_TOOLS, isToolServerTool, runToolServerTool, toolServersFor } from '../toolServers';

const tool = (name: string, parameters: unknown = { type: 'object', properties: {} }) => ({ name, description: 'Lists things.', parameters });

afterEach(() => vi.unstubAllGlobals());

describe('tools from tool servers, checked before any model sees them', () => {
  it('keeps only well-named tools with a small object schema, once each, up to the limit', () => {
    const kept = toolServerTools([
      tool('mcp__github__list_issues'),
      tool('run_command'), // Quo's own name: a tool server can't take it over
      tool('mcp__'),
      tool('mcp__has space'),
      tool(`mcp__${'x'.repeat(70)}`),
      tool('mcp__string_schema', { type: 'string' }),
      tool('mcp__list_schema', []),
      tool('mcp__huge', { type: 'object', properties: { q: { description: 'x'.repeat(20_000) } } }),
      tool('mcp__github__list_issues'),
      { name: 'mcp__no_schema', description: 'x' },
      'mcp__not_an_object',
    ]);
    expect(kept.map(one => one.name)).toEqual(['mcp__github__list_issues']);
    expect(toolServerTools('not a list')).toEqual([]);
    expect(toolServerTools(Array.from({ length: 60 }, (_, i) => tool(`mcp__s__t${i}`)))).toHaveLength(MAX_TOOL_SERVER_TOOLS);
    expect(toolServerTools([{ ...tool('mcp__long'), description: 'y'.repeat(5000) }])[0].description).toHaveLength(1200);
    expect(toolServerDefinitions(kept)).toEqual([{ type: 'function', function: { name: 'mcp__github__list_issues', description: 'Lists things.', parameters: { type: 'object', properties: {} } } }]);
  });

  it('come only from the desktop app, fewer for an offline model’s small window', async () => {
    expect(await toolServersFor(false)).toEqual([]); // no desktop app
    const many = Array.from({ length: 30 }, (_, i) => tool(`mcp__s__t${i}`));
    vi.stubGlobal('window', { quoDesktop: { toolServers: { tools: async () => ({ ok: [...many, tool('read_file')] }) } } });
    expect(await toolServersFor(false)).toHaveLength(30);
    expect(await toolServersFor(true)).toHaveLength(COMPACT_TOOL_SERVER_TOOLS);
  });
});

describe('running one in a chat without a folder', () => {
  it('goes to the desktop app (which asks first), and Stop reaches it', async () => {
    const calls: unknown[] = [];
    const aborted: string[] = [];
    let finish: (value: unknown) => void = () => {};
    vi.stubGlobal('window', { quoDesktop: { toolServers: {
      call: (chatId: string, name: string, args: unknown) => (calls.push([chatId, name, args]), new Promise(resolve => (finish = resolve))),
      abort: async (chatId: string) => (aborted.push(chatId), { ok: null }),
    } } });
    const controller = new AbortController();
    const running = runToolServerTool('chat-1', 'mcp__github__list_issues', { q: 'open' }, controller.signal);
    controller.abort();
    finish({ ok: { ok: false, text: 'Stopped.', display: { kind: 'tool' } } });
    expect(await running).toMatchObject({ ok: false });
    expect(calls).toEqual([['chat-1', 'mcp__github__list_issues', { q: 'open' }]]);
    expect(aborted).toEqual(['chat-1']);
  });

  it('says so outside the desktop app', async () => {
    expect(isToolServerTool('mcp__a__b')).toBe(true);
    expect(isToolServerTool('read_file')).toBe(false);
    expect((await runToolServerTool('c', 'mcp__a__b', {}, new AbortController().signal)).ok).toBe(false);
  });
});

describe('what the chat says about them', () => {
  it('names the tool and its server, while running, when done, declined or failed', () => {
    expect(describeRunning('mcp__github__list_issues', {})).toBe('Using list_issues from github…');
    expect(describeDone('mcp__github__list_issues', {}, { ok: true, text: '3 issues', display: { kind: 'tool', server: 'github', tool: 'list_issues' } })).toEqual({ status: 'done', title: 'Used list_issues from github', detail: { kind: 'output', body: '3 issues' } });
    expect(describeDone('mcp__github__list_issues', {}, { ok: false, text: 'No', display: { kind: 'tool', denied: true } }).title).toBe('You declined list_issues from github');
    expect(describeDone('mcp__github__list_issues', {}, { ok: false, text: 'It broke.', display: { kind: 'tool', error: true } }).title).toMatch(/^Using list_issues from github didn’t work: It broke\./);
  });
});
