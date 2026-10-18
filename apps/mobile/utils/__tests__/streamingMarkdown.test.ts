import { sanitizeStreamingMarkdown, splitStreamingBlocks, stripPartialThinkTag } from '../streamingMarkdown';

describe('sanitizeStreamingMarkdown', () => {
  it('leaves complete markdown untouched', () => {
    const text = '**Bold** and *italic* with `code` and ~~strike~~.\n\n```js\nconst x = 1;\n```\n';
    expect(sanitizeStreamingMarkdown(text)).toBe(text);
  });

  it('closes unfinished bold', () => {
    expect(sanitizeStreamingMarkdown('This is **import')).toBe('This is **import**');
  });

  it('closes unfinished italic', () => {
    expect(sanitizeStreamingMarkdown('Some *empha')).toBe('Some *empha*');
  });

  it('closes italic that follows completed bold', () => {
    expect(sanitizeStreamingMarkdown('**done** and *hal')).toBe('**done** and *hal*');
  });

  it('does not treat list bullets as unclosed italic', () => {
    const list = '- a\n* item one\n* item two';
    expect(sanitizeStreamingMarkdown(list)).toBe(list);
  });

  it('closes unfinished inline code', () => {
    expect(sanitizeStreamingMarkdown('Run `npm ins')).toBe('Run `npm ins`');
  });

  it('closes an open code fence and skips inline balancing inside it', () => {
    expect(sanitizeStreamingMarkdown('```python\nprint("**hi')).toBe('```python\nprint("**hi\n```');
  });

  it('closes unfinished strikethrough', () => {
    expect(sanitizeStreamingMarkdown('~~wro')).toBe('~~wro~~');
  });

  it('closes unfinished display math', () => {
    expect(sanitizeStreamingMarkdown('The formula $$E = mc^2')).toBe('The formula $$E = mc^2$$');
  });

  it('reduces a dangling link tail to its label', () => {
    expect(sanitizeStreamingMarkdown('See [the docs](https://exa')).toBe('See the docs');
  });

  it('drops a dangling image tail', () => {
    expect(sanitizeStreamingMarkdown('Look ![alt text](https://exa')).toBe('Look ');
  });

  it('handles empty input', () => {
    expect(sanitizeStreamingMarkdown('')).toBe('');
  });

  describe('with a cursor', () => {
    it('appends the cursor after balanced inline markers', () => {
      expect(sanitizeStreamingMarkdown('This is **import', '▍')).toBe('This is **import**▍');
    });

    it('puts the cursor inside an open fence, before the synthetic close', () => {
      expect(sanitizeStreamingMarkdown('```js\nconst x', '▍')).toBe('```js\nconst x▍\n```');
    });

    it('keeps the cursor out of the fence info string', () => {
      expect(sanitizeStreamingMarkdown('```python', '▍')).toBe('```python\n▍\n```');
    });

    it('never glues the cursor to a closing fence', () => {
      expect(sanitizeStreamingMarkdown('```\ncode\n```', '▍')).toBe('```\ncode\n```\n▍');
    });

    it('returns just the cursor for empty input', () => {
      expect(sanitizeStreamingMarkdown('', '▍')).toBe('▍');
    });
  });
});

describe('splitStreamingBlocks', () => {
  it('splits completed paragraphs from the trailing block', () => {
    expect(splitStreamingBlocks('One.\n\nTwo.\n\nThr')).toEqual({
      blocks: ['One.\n\n', 'Two.\n\n'],
      tail: 'Thr',
    });
  });

  it('keeps a block open until the next block has started', () => {
    expect(splitStreamingBlocks('One.\n\n')).toEqual({ blocks: [], tail: 'One.\n\n' });
  });

  it('does not split inside a code fence', () => {
    const text = '```\na\n\nb\n```\n\nAfter';
    expect(splitStreamingBlocks(text)).toEqual({ blocks: ['```\na\n\nb\n```\n\n'], tail: 'After' });
  });

  it('does not split inside an open code fence', () => {
    const text = 'Intro\n\n```\na\n\nb';
    expect(splitStreamingBlocks(text)).toEqual({ blocks: ['Intro\n\n'], tail: '```\na\n\nb' });
  });

  it('does not split before indented list continuations', () => {
    const text = '1. item\n\n   more of item\n\n2. next';
    expect(splitStreamingBlocks(text)).toEqual({ blocks: ['1. item\n\n   more of item\n\n'], tail: '2. next' });
  });

  it('does not split inside display math', () => {
    const text = '$$\na\n\nb\n$$\n\nEnd';
    expect(splitStreamingBlocks(text)).toEqual({ blocks: ['$$\na\n\nb\n$$\n\n'], tail: 'End' });
  });

  it('joins back to the original text', () => {
    const text = '# H\n\npara\n\n- a\n- b\n\n```js\nx\n```\n\nend';
    const { blocks, tail } = splitStreamingBlocks(text);
    expect(blocks.join('') + tail).toBe(text);
  });
});

describe('stripPartialThinkTag', () => {
  it('removes partially typed opening tags', () => {
    expect(stripPartialThinkTag('<')).toBe('');
    expect(stripPartialThinkTag('<th')).toBe('');
    expect(stripPartialThinkTag('<think')).toBe('');
    expect(stripPartialThinkTag('<think>')).toBe('');
  });

  it('removes partially typed closing tags', () => {
    expect(stripPartialThinkTag('reasoning</thi')).toBe('reasoning');
  });

  it('removes partially typed Mistral [THINK] tags', () => {
    expect(stripPartialThinkTag('[THI')).toBe('');
    expect(stripPartialThinkTag('reasoning[/THINK')).toBe('reasoning');
  });

  it('leaves ordinary text alone', () => {
    expect(stripPartialThinkTag('a cat')).toBe('a cat');
    expect(stripPartialThinkTag('4 < 5')).toBe('4 < 5');
    expect(stripPartialThinkTag('it')).toBe('it');
  });
});
