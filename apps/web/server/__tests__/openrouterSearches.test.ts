// @vitest-environment node
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.stubEnv('OPENROUTER_API_KEY', 'test-' + 'key');

let streamChat: typeof import('../openrouter.js').streamChat;
let model: import('../cloudModels.js').CloudModel;
beforeAll(async () => {
  ({ streamChat } = await import('../openrouter.js'));
  model = (await import('../cloudModels.js')).cloudModels()[0];
});
afterEach(() => vi.unstubAllGlobals());

function respond(chunks: unknown[]) {
  const body = chunks.map(c => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n';
  const sent: { body: string }[] = [];
  vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => (sent.push(init), new Response(body, { status: 200 })));
  return sent;
}

const started: string[] = [];
const run = () => streamChat(model, [{ role: 'user', content: 'news?' }], { maxTokens: 50, signal: new AbortController().signal, onDelta: () => {}, onSearch: q => started.push(q), web: { maxUses: 1 } });
const text = { choices: [{ delta: { content: 'Headline.' } }] };

describe('how many searches a reply made', () => {
  it('offers the search tool, not the old plugin', async () => {
    const sent = respond([text]);
    await run();
    const body = JSON.parse(sent[0].body);
    expect(body.tools).toEqual([{ type: 'openrouter:web_search', parameters: { engine: 'exa', max_results: 5, max_uses: 1 } }]);
    expect(body.plugins).toBeUndefined();
  });

  it('reads the count under either name OpenRouter documents', async () => {
    respond([text, { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, server_tool_use: { web_search_requests: 2 } } }]);
    expect((await run()).searches).toBe(2);
    respond([text, { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, server_tool_use_details: { web_search_requests: 1, tool_calls_requested: 1 } } }]);
    expect((await run()).searches).toBe(1);
  });

  it('counts the search records in the reasoning details when the usage leaves it out, once each', async () => {
    const record = { type: 'reasoning.server_tool_call', tool_name: 'openrouter:web_search', tool_call_id: 'ws_1' };
    respond([{ choices: [{ delta: { reasoning_details: [record] } }] }, { choices: [{ delta: { reasoning_details: [record] } }] }, text, { choices: [{ delta: {} }], usage: { prompt_tokens: 1, completion_tokens: 1 } }]);
    expect((await run()).searches).toBe(1);
  });

  it('announces each search once as it starts, with its words, and collects the pages cited', async () => {
    started.length = 0;
    const record = { type: 'reasoning.server_tool_call', tool_name: 'openrouter:web_search', tool_call_id: 'ws_9', arguments: '{"query":"leeds weather"}' };
    respond([{ choices: [{ delta: { reasoning_details: [record] } }] }, { choices: [{ delta: { reasoning_details: [record], content: 'Rain', annotations: [{ type: 'url_citation', url_citation: { url: 'https://met.example/', title: 'Met' } }, { type: 'url_citation', url_citation: { url: 'javascript:x' } }] } }] }]);
    const usage = await run();
    expect(started).toEqual(['leeds weather']);
    expect(usage.sources).toEqual([{ url: 'https://met.example/', title: 'Met' }]);
  });

  it('is none when nothing says a search ran, and ignores nonsense', async () => {
    respond([text, { choices: [{ delta: { reasoning_details: [{ type: 'reasoning.text' }] } }], usage: { server_tool_use: { web_search_requests: -3 }, server_tool_use_details: { web_search_requests: 'x' } } }]);
    expect((await run()).searches).toBe(0);
  });
});
