import { describe, expect, it } from 'vitest';
import { addAnnotations, addSource, MAX_SOURCES, pickSources, queryOf, serverSearches, type WebSource } from '../../../shared/webSources';
import { SearchSteps } from '../searchSteps';
import { anthropic } from '../../providers/anthropic';
import { openai } from '../../providers/openai';
import type { Streamed } from '../../providers/wire';
import { chopped, sse, streamOf } from '../../providers/__tests__/helpers';
import { fromWire, toWire } from '../../sync/adapters';

describe('sources from a third party', () => {
  it('takes only plain web addresses, once each, with short one-line titles', () => {
    const list: WebSource[] = [];
    addSource(list, 'https://news.example/a', '  Big\n  story  ');
    addSource(list, 'https://news.example/a', 'Again');
    for (const bad of ['javascript:alert(1)', 'data:text/html,<b>x</b>', 'file:///etc/passwd', 'https://user:pass' + '@' + 'evil.example/', 'not a url', 42, null, `https://x.example/${'a'.repeat(3000)}`]) addSource(list, bad, 'x');
    addSource(list, 'http://plain.example', 'T'.repeat(500));
    expect(list).toEqual([{ url: 'https://news.example/a', title: 'Big story' }, { url: 'http://plain.example/', title: 'T'.repeat(160) }]);
  });

  it('keeps a handful at most', () => {
    const list: WebSource[] = [];
    for (let i = 0; i < 40; i++) addSource(list, `https://s${i}.example/`);
    expect(list).toHaveLength(MAX_SOURCES);
  });

  it('reads OpenAI-style citations, nested or flat, and ignores everything else', () => {
    const list: WebSource[] = [];
    addAnnotations(list, [{ type: 'url_citation', url_citation: { url: 'https://a.example/', title: 'A' } }, { type: 'url_citation', url: 'https://b.example/', title: 'B' }, { type: 'file_citation', url: 'https://c.example/' }, null, 'x']);
    addAnnotations(list, 'nope');
    expect(list.map(s => s.url)).toEqual(['https://a.example/', 'https://b.example/']);
  });

  it('finds the words a search used, and OpenRouter’s records of its searches', () => {
    expect(queryOf('{"query":"  weather   in Leeds "}')).toBe('weather in Leeds');
    expect(queryOf({ query: 'x' })).toBe('x');
    expect(queryOf('{broken')).toBe('');
    expect(queryOf({ q: 'x' })).toBe('');
    expect(serverSearches([{ type: 'reasoning.server_tool_call', tool_name: 'openrouter:web_search', tool_call_id: 'a', arguments: '{"query":"news"}' }, { type: 'reasoning.server_tool_call', tool_name: 'openrouter:datetime', tool_call_id: 'b' }, { type: 'reasoning.text' }])).toEqual([{ id: 'a', query: 'news' }]);
    expect(serverSearches(undefined)).toEqual([]);
  });

  it('for the desktop’s own tools: pages read first, then results the reply links to, else the top few results', () => {
    const read = [{ url: 'https://read.example/' }];
    const found = [{ url: 'https://one.example/' }, { url: 'https://two.example/' }, { url: 'https://three.example/' }, { url: 'https://four.example/' }];
    expect(pickSources(read, found, 'See https://three.example/ for more').map(s => s.url)).toEqual(['https://read.example/', 'https://three.example/']);
    expect(pickSources([], found, 'No links.').map(s => s.url)).toEqual(['https://one.example/', 'https://two.example/', 'https://three.example/']);
    expect(pickSources([], [], 'Nothing')).toEqual([]);
  });
});

describe('search steps for a provider’s own search', () => {
  it('shows each search running, then done, with its words', () => {
    const steps = new SearchSteps();
    expect(steps.start('uk news')).toMatchObject([{ tool: 'web_search', status: 'running', title: 'Searching the web for “uk news”…' }]);
    steps.start('');
    expect(steps.name('second words')[1].title).toBe('Searching the web for “second words”…');
    const done = steps.finish(true)!;
    expect(done.map(s => [s.status, s.title])).toEqual([['done', 'Searched the web for “uk news”'], ['done', 'Searched the web for “second words”']]);
    expect(done.every(s => s.text === undefined)).toBe(true);
  });

  it('marks a search done once more of the answer arrives after it started, and only says so once', () => {
    const steps = new SearchSteps();
    steps.start('weather', 20); // the model wrote 20 characters, then searched
    expect(steps.answering(20)).toBeNull();
    expect(steps.answering(25)).toMatchObject([{ status: 'done', title: 'Searched the web for “weather”' }]);
    expect(steps.answering(30)).toBeNull();
  });

  it('adds one step for a search the provider only counted, none when there was no search, and marks a stopped one', () => {
    expect(new SearchSteps().finish(true)).toMatchObject([{ status: 'done', title: 'Searched the web' }]);
    expect(new SearchSteps().finish(false)).toBeUndefined();
    const stopped = new SearchSteps();
    stopped.start('x');
    expect(stopped.finish(false, true)![0].status).toBe('stopped');
  });
});

describe('the user’s own keys', () => {
  it('OpenRouter: each search once as it starts, and the pages cited', async () => {
    const record = { type: 'reasoning.server_tool_call', tool_name: 'openrouter:web_search', tool_call_id: 'ws1', arguments: '{"query":"leeds weather"}' };
    const text = sse({ choices: [{ delta: { reasoning_details: [record] } }] }, { choices: [{ delta: { reasoning_details: [record], content: 'Rain.' } }] }, { choices: [{ delta: { annotations: [{ type: 'url_citation', url_citation: { url: 'https://met.example/leeds', title: 'Leeds forecast' } }, { type: 'url_citation', url_citation: { url: 'javascript:alert(1)' } }] }, finish_reason: 'stop' }] }, '[DONE]');
    const seen: Streamed[] = [];
    const reply = await openai.read(streamOf(...chopped(text, 9)), partial => seen.push(partial));
    expect(seen.at(-1)?.searches).toEqual(['leeds weather']);
    expect(reply.sources).toEqual([{ url: 'https://met.example/leeds', title: 'Leeds forecast' }]);
  });

  it('Anthropic: its search with words that stream in, its results, and citations; never as one of our tool calls', async () => {
    const text = sse(
      { type: 'content_block_start', index: 0, content_block: { type: 'server_tool_use', id: 'srv1', name: 'web_search' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"query":"ne' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: 'ws today"}' } },
      { type: 'content_block_start', index: 1, content_block: { type: 'web_search_tool_result', content: [{ type: 'web_search_result', url: 'https://bbc.example/1', title: 'One' }, { type: 'web_search_result', url: 'ftp://bad.example/' }] } },
      { type: 'content_block_delta', index: 2, delta: { type: 'citations_delta', citation: { type: 'web_search_result_location', url: 'https://ft.example/2', title: 'Two' } } },
      { type: 'content_block_delta', index: 2, delta: { type: 'text_delta', text: 'Here is the news.' } },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
    );
    const seen: Streamed[] = [];
    const reply = await anthropic.read(streamOf(...chopped(text, 11)), partial => seen.push(partial));
    expect(seen.at(-1)?.searches).toEqual(['news today']);
    expect(reply.sources?.map(s => s.url)).toEqual(['https://bbc.example/1', 'https://ft.example/2']);
    expect(reply.toolCalls).toEqual([]);
    expect(reply.finish).toBe('stop');
  });
});

describe('sources and sync', () => {
  it('stay on this device: never sent, and kept when the chat comes back from another device', () => {
    const chat = { id: 'c', title: 't', createdAt: 1, updatedAt: 1, messages: [{ id: 'm', role: 'assistant' as const, content: 'x', sources: [{ url: 'https://a.example/' }] }] };
    const wire = toWire(chat);
    expect(JSON.stringify(wire)).not.toContain('a.example');
    expect(fromWire(wire, chat).messages[0].sources).toEqual([{ url: 'https://a.example/' }]);
  });
});
