import { useRef } from 'react';
import type { Element, ElementContent, Root, RootContent, Text } from 'hast';

/**
 * The newest words of a reply dissolve in through the dither (styles/dither.css), and a caret follows the last one. A reply is drawn again on every
 * update, so each arrival is remembered as a chunk (where it starts in the text, and when it came), the text of chunks
 * still dissolving is wrapped in spans, and each span's animation is set to its chunk's age after every draw. Old text
 * is plain and solid.
 */

/** How long a chunk dissolves for: the `.fresh` animation in styles/dither.css, which must be no longer. */
export const FRESH_MS = 300;

export interface Chunk { offset: number; at: number }
export interface Fresh { text: string; chunks: Chunk[] }

/** The chunks after the text became `text` at `now`: what was added is a chunk of its own, and chunks older than FRESH_MS go. */
export function advance(previous: Fresh, text: string, now: number): Fresh {
  if (!text.startsWith(previous.text)) return { text, chunks: [] }; // rewritten, not added to: shown as it is
  const kept = previous.chunks.filter(chunk => now - chunk.at < FRESH_MS);
  return { text, chunks: text.length > previous.text.length ? [...kept, { offset: previous.text.length, at: now }] : kept };
}

/** The chunks of a reply being written, kept from one draw to the next; none once it is finished. */
export function useFresh(text: string, live: boolean): Chunk[] {
  const state = useRef<Fresh>({ text: '', chunks: [] });
  if (!live) {
    state.current = { text, chunks: [] };
    return state.current.chunks;
  }
  if (state.current.text !== text) state.current = advance(state.current, text, performance.now());
  return state.current.chunks;
}

// Code is drawn by its own component from its text, and maths by KaTeX: neither is wrapped.
const SKIP = new Set(['pre', 'code', 'svg', 'math']);
const isMath = (node: Element) => [node.properties?.className].flat().some(name => String(name).startsWith('katex'));

/** Splits a text node where chunks begin, wrapping the fresh parts. Positions are in the markdown source; the text can be
 *  shorter (escapes, entities, trimmed line ends), so they're counted from the node's end, where new text arrives. */
export function splitText(node: Text, chunks: Chunk[]): (Text | Element)[] {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (start === undefined || end === undefined || !chunks.length || end <= chunks[0].offset) return [node];
  const { value } = node;
  const index = (offset: number) => Math.min(value.length, Math.max(0, value.length - (end - offset)));
  const parts: (Text | Element)[] = [];
  const first = index(Math.max(start, chunks[0].offset));
  if (first > 0) parts.push({ type: 'text', value: value.slice(0, first) });
  chunks.forEach((chunk, i) => {
    const from = Math.max(chunk.offset, start);
    const to = Math.min(chunks[i + 1]?.offset ?? end, end);
    const text = to > from ? value.slice(index(from), index(to)) : '';
    if (text) parts.push({ type: 'element', tagName: 'span', properties: { className: ['fresh'], dataAt: String(chunk.at) }, children: [{ type: 'text', value: text }] });
  });
  return parts;
}

function wrap(parent: Root | Element, chunks: Chunk[]): void {
  const children: (RootContent | ElementContent)[] = [];
  for (const child of parent.children) {
    if (child.type === 'text') children.push(...splitText(child, chunks));
    else {
      if (child.type === 'element' && !SKIP.has(child.tagName) && !isMath(child)) wrap(child, chunks);
      children.push(child);
    }
  }
  parent.children = children as typeof parent.children;
}

type Spot = { parent: Root | Element; index: number };

/** Where the last word of the text is: a spot after it, `'code'` when the text ends in code or maths (the caret is
 *  drawn there by dither.css), or null when there's no text in this part. */
function lastWord(parent: Root | Element): Spot | 'code' | null {
  for (let index = parent.children.length - 1; index >= 0; index--) {
    const child = parent.children[index];
    if (child.type === 'text' && child.value.trim()) return { parent, index: index + 1 };
    if (child.type !== 'element') continue;
    if (SKIP.has(child.tagName) || isMath(child)) return 'code';
    const found = lastWord(child);
    if (found) return found;
  }
  return null;
}

const CARET: Element = { type: 'element', tagName: 'span', properties: { className: ['caret'], ariaHidden: 'true' }, children: [] };

/**
 * A rehype plugin for a reply being written: a caret (a block of dither) just after its last word, wherever that is (a
 * list inside a list, a heading, a quote, bold text), and its fresh text wrapped in `<span class="fresh" data-at>`.
 */
export const rehypeFresh = (chunks: Chunk[]) => () => (tree: Root) => {
  const spot = lastWord(tree);
  if (spot && spot !== 'code') spot.parent.children.splice(spot.index, 0, { ...CARET });
  if (chunks.length) wrap(tree, chunks);
};

const synced = new WeakMap<HTMLElement, number>();

/** Sets each fresh span's dissolve to its chunk's age. A span React reused for a newer chunk starts again from there. */
export function syncFresh(root: HTMLElement, now = performance.now()): void {
  for (const span of root.querySelectorAll<HTMLElement>('.fresh')) {
    const at = Number(span.dataset.at);
    if (synced.get(span) === at) continue;
    synced.set(span, at);
    for (const animation of span.getAnimations?.() ?? []) animation.currentTime = Math.max(0, now - at);
  }
}
