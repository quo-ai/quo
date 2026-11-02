import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Text } from 'hast';
import { FRESH_MS, advance, splitText, type Chunk } from '../fresh';
import { Markdown } from '../Markdown';

const text = (value: string, start: number, end = start + value.length): Text => ({ type: 'text', value, position: { start: { line: 1, column: 1, offset: start }, end: { line: 1, column: 1, offset: end } } });
const spans = (parts: ReturnType<typeof splitText>) => parts.map(part => (part.type === 'text' ? part.value : `[${(part.children[0] as Text).value}@${part.properties.dataAt}]`)).join('');

describe('the newest words of a reply', () => {
  it('are a chunk for each update, kept while they dissolve', () => {
    let fresh = advance({ text: '', chunks: [] }, 'Hello', 0);
    fresh = advance(fresh, 'Hello wor', 100);
    expect(fresh.chunks).toEqual([{ offset: 0, at: 0 }, { offset: 5, at: 100 }]);
    fresh = advance(fresh, 'Hello world', FRESH_MS + 50);
    expect(fresh.chunks).toEqual([{ offset: 5, at: 100 }, { offset: 9, at: FRESH_MS + 50 }]);
  });

  it('are none when the text was rewritten rather than added to', () => {
    expect(advance({ text: 'Hello world', chunks: [{ offset: 0, at: 0 }] }, 'Goodbye', 10).chunks).toEqual([]);
  });

  it('are split out of the text where each chunk begins, older text left plain', () => {
    const chunks: Chunk[] = [{ offset: 6, at: 1 }, { offset: 9, at: 2 }];
    expect(spans(splitText(text('Hello world', 0), chunks))).toBe('Hello [wor@1][ld@2]');
    expect(spans(splitText(text('Old line', 0), [{ offset: 20, at: 1 }]))).toBe('Old line');
    // A later paragraph: its offsets start past the chunk's.
    expect(spans(splitText(text('new', 12), chunks))).toBe('[new@2]');
  });

  it('are counted from the end when the text is shorter than its markdown (escapes, entities)', () => {
    // "a \*b\* c" in the source is "a *b* c" on screen: 9 characters of markdown for 7 of text.
    expect(spans(splitText(text('a *b* c', 0, 9), [{ offset: 8, at: 1 }]))).toBe('a *b* [c@1]');
  });

  it('are followed by a caret, wherever the last word is', () => {
    const caret = (text: string) => renderToStaticMarkup(createElement(Markdown, { text, live: true })).replace(/<span class="fresh" data-at="[\d.]+">([^<]*)<\/span>/g, '$1');
    expect(caret('Plain words')).toContain('Plain words<span class="caret" aria-hidden="true"></span></p>');
    expect(caret('- one\n- two **bold**')).toContain('<strong>bold<span class="caret" aria-hidden="true"></span></strong></li>');
    expect(caret('> quoted')).toContain('quoted<span class="caret"');
    expect(caret('# Heading')).toContain('Heading<span class="caret"');
    // Ending in code: dither.css draws it at the end of the code instead.
    expect(caret('Look:\n\n```js\nconst a = 1;\n```')).not.toContain('class="caret"');
    expect(renderToStaticMarkup(createElement(Markdown, { text: 'Done.' }))).not.toContain('caret');
  });

  it('dissolve in a reply being written, but never in code, and not once it is finished', () => {
    const live = renderToStaticMarkup(createElement(Markdown, { text: 'Some **words**.\n\n```js\nconst a = 1;\n```', live: true }));
    expect(live).toContain('<span class="fresh"');
    expect(live).toMatch(/<strong><span class="fresh" data-at="[\d.]+">words<\/span><\/strong>/);
    expect(live.slice(live.indexOf('<pre'))).not.toContain('fresh');
    expect(renderToStaticMarkup(createElement(Markdown, { text: 'Some **words**.' }))).not.toContain('fresh');
  });
});
