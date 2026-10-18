import { describe, expect, it } from 'vitest';
import { anthropic, convert } from '../anthropic';
import { openai } from '../openai';
import { sseEvents } from '../sse';
import type { ChatReply, WireMessage, WireTool } from '../wire';
import { chopped, sse, streamOf } from './helpers';

const noop = () => {};
const readOpenai = (text: string, size = 5): Promise<ChatReply> => openai.read(streamOf(...chopped(text, size)), noop);
const readAnthropic = (text: string, size = 5): Promise<ChatReply> => anthropic.read(streamOf(...chopped(text, size)), noop);
const tool: WireTool = { type: 'function', function: { name: 'read_file', description: 'Read a file', parameters: { type: 'object', properties: { path: { type: 'string' } } } } };

describe('reading a server-sent-event stream', () => {
  it('finds events however the bytes are cut, with CRLF line ends, comments and multi-line data', async () => {
    const text = ': keep-alive\r\n\r\nevent: one\r\ndata: {"a":1}\r\n\r\ndata: line1\ndata: line2\n\nevent: last\ndata: tail';
    for (const size of [1, 2, 3, 5, 100]) {
      const events = [];
      for await (const event of sseEvents(streamOf(...chopped(text, size)))) events.push(event);
      expect(events, `size ${size}`).toEqual([{ event: 'one', data: '{"a":1}' }, { event: null, data: 'line1\nline2' }, { event: 'last', data: 'tail' }]);
    }
  });

  it('keeps multi-byte characters whole across pieces', async () => {
    const bytes = new TextEncoder().encode('data: héllo ✓\n\n');
    const stream = new ReadableStream<Uint8Array>({ start(c) { for (const b of bytes) c.enqueue(new Uint8Array([b])); c.close(); } });
    const events = [];
    for await (const event of sseEvents(stream)) events.push(event);
    expect(events).toEqual([{ event: null, data: 'héllo ✓' }]);
  });
});

describe('the OpenAI wire format', () => {
  it('asks for a stream, with usage and tools only when wanted', () => {
    const messages: WireMessage[] = [{ role: 'user', content: 'hi' }];
    expect(openai.body({ model: 'gpt-x', messages, maxTokens: 100 }, false)).toEqual({ model: 'gpt-x', messages, stream: true });
    expect(openai.body({ model: 'gpt-x', messages, maxTokens: 100, tools: [tool] }, true)).toMatchObject({ stream_options: { include_usage: true }, tools: [tool], tool_choice: 'auto' });
  });

  it('sends null, not an empty string, for an assistant turn that only called tools', () => {
    const messages: WireMessage[] = [{ role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'read_file', arguments: '{}' } }] }, { role: 'tool', tool_call_id: 'c1', content: 'ok' }];
    const body = openai.body({ model: 'm', messages, maxTokens: 1 }, false) as { messages: { content: unknown }[] };
    expect(body.messages[0].content).toBeNull();
    expect(body.messages[1].content).toBe('ok');
  });

  it('collects text and reasoning as they stream, with the finish reason and usage', async () => {
    const updates: string[] = [];
    const text = sse(
      { choices: [{ delta: { reasoning_content: 'Hmm. ' } }] }, { choices: [{ delta: { reasoning: 'Ok.' } }] },
      { choices: [{ delta: { content: 'Hello' } }] }, { choices: [{ delta: { content: ' there' }, finish_reason: 'stop' }] },
      { choices: [], usage: { prompt_tokens: 12, completion_tokens: 3 } }, '[DONE]', { choices: [{ delta: { content: 'ignored' } }] },
    );
    const reply = await openai.read(streamOf(...chopped(text, 9)), partial => updates.push(partial.content));
    expect(reply).toEqual({ content: 'Hello there', reasoning: 'Hmm. Ok.', toolCalls: [], finish: 'stop', usage: { input: 12, output: 3 } });
    expect(updates.at(-1)).toBe('Hello there');
  });

  it('puts tool calls together from their pieces, in order, even several at once', async () => {
    const text = sse(
      { choices: [{ delta: { content: 'Looking. ', tool_calls: [{ index: 0, id: 'call_a', function: { name: 'read_file', arguments: '' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"pa' } }, { index: 1, id: 'call_b', function: { name: 'list_directory', arguments: '{}' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'th":"a.ts"}' } }] }, finish_reason: 'tool_calls' }] },
    );
    const reply = await readOpenai(text);
    expect(reply.toolCalls).toEqual([{ id: 'call_a', name: 'read_file', arguments: '{"path":"a.ts"}' }, { id: 'call_b', name: 'list_directory', arguments: '{}' }]);
    expect(reply.finish).toBe('tool_calls');
    expect(reply.content).toBe('Looking. ');
  });

  it('copes with servers that leave out ids and indexes, send arguments as an object, or end with "stop" after calling tools', async () => {
    const text = sse(
      { choices: [{ delta: { tool_calls: [{ function: { name: 'read_file', arguments: '{"path"' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ function: { arguments: ':"x"}' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ id: 'z', function: { name: 'find_files', arguments: { pattern: '*.ts' } } }] }, finish_reason: 'stop' }] },
    );
    const reply = await readOpenai(text);
    expect(reply.toolCalls).toEqual([{ id: 'call_1', name: 'read_file', arguments: '{"path":"x"}' }, { id: 'z', name: 'find_files', arguments: '{"pattern":"*.ts"}' }]);
    expect(reply.finish).toBe('tool_calls');
  });

  it('turns an error in the middle of a stream into an error', async () => {
    await expect(readOpenai(sse({ choices: [{ delta: { content: 'Hi' } }] }, { error: { message: 'The server is overloaded' } }))).rejects.toMatchObject({ code: 'provider_failed', message: expect.stringContaining('overloaded') });
  });

  it('ignores lines that aren’t JSON', async () => {
    const reply = await readOpenai(`data: not json\n\n${sse({ choices: [{ delta: { content: 'ok' } }] })}`);
    expect(reply.content).toBe('ok');
  });
});

describe('turning a conversation into Anthropic’s format', () => {
  const call = (id: string, name: string, args = '{}') => ({ id, type: 'function' as const, function: { name, arguments: args } });

  it('takes the system prompt out, and makes tool calls and their results blocks', () => {
    const { system, turns } = convert([
      { role: 'system', content: 'Rules.' },
      { role: 'user', content: 'Fix it' },
      { role: 'assistant', content: 'Reading.', tool_calls: [call('t1', 'read_file', '{"path":"a"}'), call('t2', 'list_directory')] },
      { role: 'tool', tool_call_id: 't1', content: 'file text' },
      { role: 'tool', tool_call_id: 't2', content: '' },
      { role: 'user', content: 'and then?' },
    ]);
    expect(system).toBe('Rules.');
    expect(turns).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'Fix it' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'Reading.' }, { type: 'tool_use', id: 't1', name: 'read_file', input: { path: 'a' } }, { type: 'tool_use', id: 't2', name: 'list_directory', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'file text' }, { type: 'tool_result', tool_use_id: 't2', content: '(no output)' }, { type: 'text', text: 'and then?' }] },
    ]);
  });

  it('drops empty messages, and makes broken tool arguments an empty object', () => {
    const { turns } = convert([{ role: 'user', content: 'go' }, { role: 'assistant', content: '  ', tool_calls: [call('t', 'x', '{oops')] }, { role: 'assistant', content: '' }]);
    expect(turns[1].content).toEqual([{ type: 'tool_use', id: 't', name: 'x', input: {} }]);
    expect(turns).toHaveLength(2);
  });

  it('asks for a stream with the tools, a limit, and the unchanged start marked for reuse', () => {
    const body = anthropic.body({ model: 'claude-x', maxTokens: 4096, tools: [tool], messages: [{ role: 'system', content: 'Rules.' }, { role: 'user', content: 'hi' }] }, true) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: 'claude-x', max_tokens: 4096, stream: true, tool_choice: { type: 'auto' },
      system: [{ type: 'text', text: 'Rules.', cache_control: { type: 'ephemeral' } }],
      tools: [{ name: 'read_file', description: 'Read a file', input_schema: tool.function.parameters }],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi', cache_control: { type: 'ephemeral' } }] }],
    });
  });

  it('leaves the cache mark off a tool call, which can’t carry one', () => {
    const body = anthropic.body({ model: 'm', maxTokens: 1, messages: [{ role: 'user', content: 'x' }, { role: 'assistant', content: '', tool_calls: [call('a', 'b')] }] }, true) as { messages: { content: object[] }[] };
    expect(JSON.stringify(body.messages)).not.toContain('cache_control');
  });
});

describe('reading Anthropic’s stream', () => {
  const events = (...list: [string, object][]) => sse(...list);

  it('collects text, thinking and usage (cached tokens count as input)', async () => {
    const reply = await readAnthropic(events(
      ['message_start', { type: 'message_start', message: { usage: { input_tokens: 20, cache_read_input_tokens: 100, cache_creation_input_tokens: 5, output_tokens: 1 } } }],
      ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } }],
      ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Let me see.' } }],
      ['ping', { type: 'ping' }],
      ['content_block_start', { type: 'content_block_start', index: 1, content_block: { type: 'text' } }],
      ['content_block_delta', { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Hi ' } }],
      ['content_block_delta', { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'there' } }],
      ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 9 } }],
      ['message_stop', { type: 'message_stop' }],
    ));
    expect(reply).toEqual({ content: 'Hi there', reasoning: 'Let me see.', toolCalls: [], finish: 'stop', usage: { input: 125, output: 9 } });
  });

  it('assembles tool calls from streamed JSON, in order', async () => {
    const reply = await readAnthropic(events(
      ['message_start', { type: 'message_start', message: { usage: { input_tokens: 1 } } }],
      ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text' } }],
      ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Reading.' } }],
      ['content_block_start', { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_1', name: 'read_file' } }],
      ['content_block_delta', { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"path":' } }],
      ['content_block_delta', { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '"a.ts"}' } }],
      ['content_block_start', { type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'toolu_2', name: 'list_directory' } }],
      ['message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 4 } }],
    ), 3);
    expect(reply.toolCalls).toEqual([{ id: 'toolu_1', name: 'read_file', arguments: '{"path":"a.ts"}' }, { id: 'toolu_2', name: 'list_directory', arguments: '{}' }]);
    expect(reply.finish).toBe('tool_calls');
    expect(reply.content).toBe('Reading.');
  });

  it('maps stop reasons, and turns an error event into an error', async () => {
    expect((await readAnthropic(events(['message_delta', { type: 'message_delta', delta: { stop_reason: 'max_tokens' } }]))).finish).toBe('length');
    await expect(readAnthropic(events(['error', { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }]))).rejects.toMatchObject({ code: 'provider_failed', message: expect.stringContaining('Overloaded') });
  });
});
