import { parseToolCalls, stripToolCalls, convertNativeToolCalls } from '../tools';

describe('parseToolCalls', () => {
  it('parses a basic tool call with arguments', () => {
    const calls = parseToolCalls('Sure! [TOOL:save_memory(content="likes pizza")]');
    expect(calls).toEqual([{ name: 'save_memory', args: { content: 'likes pizza' } }]);
  });

  it('parses calls without arguments', () => {
    expect(parseToolCalls('[TOOL:get_date()]')).toEqual([{ name: 'get_date', args: {} }]);
  });

  it('is case-insensitive and handles markdown-wrapped calls', () => {
    expect(parseToolCalls('**[tool:get_date()]**')).toEqual([{ name: 'get_date', args: {} }]);
    expect(parseToolCalls('__[Tool: get_user_info()]__')).toHaveLength(1);
  });

  it('parses multiple calls and single-quoted args', () => {
    const calls = parseToolCalls("[TOOL:get_date()] and [TOOL:delete_memory(content='old fact')]");
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual({ name: 'delete_memory', args: { content: 'old fact' } });
  });

  it('returns empty array when there are no tool calls', () => {
    expect(parseToolCalls('Just a normal response.')).toEqual([]);
  });

  it('keeps apostrophes inside double-quoted values', () => {
    expect(parseToolCalls(`[TOOL:save_memory(content="User's dog is Rex")]`)).toEqual([
      { name: 'save_memory', args: { content: "User's dog is Rex" } },
    ]);
  });

  it('recovers an unescaped apostrophe inside a single-quoted value', () => {
    expect(parseToolCalls(`[TOOL:save_memory(content='User's dog is Rex')]`)).toEqual([
      { name: 'save_memory', args: { content: "User's dog is Rex" } },
    ]);
  });

  it('allows parentheses inside values', () => {
    expect(parseToolCalls('[TOOL:save_memory(content="likes (spicy) food")]')).toEqual([
      { name: 'save_memory', args: { content: 'likes (spicy) food' } },
    ]);
  });

  it('parses multiple arguments and escaped quotes', () => {
    expect(parseToolCalls('[TOOL:x(a="say \\"hi\\"", b=\'two\')]')).toEqual([
      { name: 'x', args: { a: 'say "hi"', b: 'two' } },
    ]);
  });
});

describe('stripToolCalls', () => {
  it('removes tool markers and collapses leftover blank lines', () => {
    const text = 'Saved!\n\n\n[TOOL:save_memory(content="x")]\n\nDone.';
    expect(stripToolCalls(text)).toBe('Saved!\n\nDone.');
  });

  it('removes markdown-wrapped markers', () => {
    expect(stripToolCalls('**[TOOL:get_date()]** Today is Monday.')).toBe('Today is Monday.');
  });

  it('removes markers whose values contain parentheses', () => {
    expect(stripToolCalls('Noted. [TOOL:save_memory(content="likes (spicy) food")]')).toBe('Noted.');
  });

  it('trims surrounding whitespace', () => {
    expect(stripToolCalls('  hello  ')).toBe('hello');
  });
});

describe('convertNativeToolCalls', () => {
  it('converts JSON arguments to string args', () => {
    const calls = convertNativeToolCalls([
      { type: 'function', function: { name: 'save_memory', arguments: '{"content":"fact","priority":2}' } },
    ]);
    expect(calls).toEqual([{ name: 'save_memory', args: { content: 'fact', priority: '2' } }]);
  });

  it('falls back to a content arg for non-JSON arguments', () => {
    const calls = convertNativeToolCalls([
      { type: 'function', function: { name: 'save_memory', arguments: 'plain text' } },
    ]);
    expect(calls).toEqual([{ name: 'save_memory', args: { content: 'plain text' } }]);
  });

  it('produces empty args for empty argument strings', () => {
    const calls = convertNativeToolCalls([
      { type: 'function', function: { name: 'get_date', arguments: '' } },
    ]);
    expect(calls).toEqual([{ name: 'get_date', args: {} }]);
  });
});
