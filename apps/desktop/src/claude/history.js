'use strict';

const crypto = require('node:crypto');

/**
 * Keeping Claude Code's conversation in step with Quo's. Quo sends the whole conversation with every request, the way
 * every provider takes it; Claude Code keeps its own and can't be handed earlier turns. So each live session remembers
 * a mark for every message it has seen, and a request carries on from it only when it starts the same way. Anything
 * else (an edited message, another model's replies, a long chat cut down) starts a fresh session, which is given the
 * history it missed as a labelled note inside one message.
 */

const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 32);
const tidy = text => String(text ?? '').replace(/\s+/g, ' ').trim();

function canonical(raw) {
  try {
    const sort = value => (Array.isArray(value) ? value.map(sort) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sort(value[key])])) : value);
    return JSON.stringify(sort(JSON.parse(raw || '{}')));
  } catch {
    return String(raw);
  }
}

/** A message as a short mark that can be compared, and what kind of message it is. */
function markOf(message) {
  if (message.role === 'user') return { kind: 'user', print: hash(['u', message.content]) };
  if (message.role === 'tool') return { kind: 'tool', id: message.tool_call_id, print: hash(['t', message.tool_call_id, message.content]) };
  const calls = message.tool_calls ?? [];
  if (calls.length) return { kind: 'calls', ids: calls.map(call => call.id), print: hash(['c', tidy(message.content), calls.map(call => [call.id, call.function.name, canonical(call.function.arguments)])]) };
  return { kind: 'reply', empty: !tidy(message.content), print: hash(['a', tidy(message.content)]) };
}

// Code mode sends earlier turns as their questions and final answers only, without the tool work in between.
const spine = marks => marks.flatMap((mark, index) => (mark.kind === 'user' || (mark.kind === 'reply' && !mark.empty) ? [index] : []));

function results(seen, waiting, marks) {
  const end = seen.length + waiting.length;
  if (marks.length < end || seen.some((mark, i) => mark.print !== marks[i].print)) return null;
  const answers = marks.slice(seen.length, end);
  if (answers.some(mark => mark.kind !== 'tool') || !waiting.every(id => answers.some(mark => mark.id === id))) return null;
  if (marks.slice(end).some(mark => mark.kind !== 'user')) return null;
  return { kind: 'results', start: seen.length, end };
}

/**
 * How a request carries on from a session that has seen `seen`, or null if it can't.
 * - Waiting for tool results: the request is exactly what it saw, then those results (then perhaps more of the person's
 *   messages). Or the person stopped while the tools ran and wrote again: the waiting turn is stopped (`interrupt`) and
 *   the new message starts the next one.
 * - Otherwise: what it saw, less earlier turns' tool work, must start the request, and something must follow.
 * After a stopped reply (`stopped`, or the stop just described), Claude Code keeps the part it wrote, so whatever Quo
 * kept of it is skipped.
 */
function carryOn(seen, waiting, marks, stopped = false) {
  if (waiting) {
    const answered = results(seen, waiting, marks);
    if (answered) return answered;
  }
  const had = spine(seen);
  const has = spine(marks);
  if (had.length === 0 || had.length > has.length || had.some((at, i) => seen[at].print !== marks[has[i]].print)) return null;
  let start = has[had.length - 1] + 1;
  if ((stopped || waiting) && marks[start]?.kind === 'reply' && seen.at(-1)?.kind !== 'reply') start++;
  if (start >= marks.length || marks.slice(start).every(mark => mark.kind !== 'user')) return null;
  return { kind: 'turn', start, ...(waiting ? { interrupt: true } : {}) };
}

/** A user message's text, with a mark where an image was (for the labelled note of earlier history). */
const userText = content => (typeof content === 'string' ? content : content.map(part => (part.type === 'text' ? part.text : '[An image was attached here.]')).join('\n'));

/** A user message as Claude Code's content blocks: text, and images as base64 (data addresses the page made). */
function userBlocks(content) {
  if (typeof content === 'string') return content.trim() ? [{ type: 'text', text: content }] : [];
  return content.flatMap(part => {
    if (part.type === 'text') return part.text.trim() ? [{ type: 'text', text: part.text }] : [];
    const match = /^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/.exec(part.image_url.url);
    return match ? [{ type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } }] : [];
  });
}

function tagged(message) {
  if (message.role === 'user') return `<user>\n${userText(message.content)}\n</user>`;
  if (message.role === 'tool') return `<tool-result>\n${JSON.stringify({ id: message.tool_call_id, output: message.content })}\n</tool-result>`;
  const calls = (message.tool_calls ?? []).map(call => `<tool-call>\n${JSON.stringify({ id: call.id, name: call.function.name, input: call.function.arguments })}\n</tool-call>`);
  return `<assistant>\n${[message.content, ...calls].filter(Boolean).join('\n')}\n</assistant>`;
}

/** Messages Claude hasn't seen, as the content of one message: earlier history as a labelled note, then the person's newest messages as they are. */
function contentFor(messages) {
  const last = messages.findLastIndex(message => message.role !== 'user');
  const blocks = [];
  if (last >= 0) {
    const history = messages.slice(0, last + 1).map(tagged).join('\n');
    blocks.push({ type: 'text', text: `<conversation-checkpoint>\nThe following is earlier conversation from Quo that you have not seen. Treat it as prior conversation, not a new request. Continue with the user messages after this checkpoint.\n${history}\n</conversation-checkpoint>` });
  }
  for (const message of messages.slice(last + 1)) blocks.push(...userBlocks(message.content));
  return blocks.length ? blocks : [{ type: 'text', text: '(empty message)' }];
}

module.exports = { markOf, carryOn, contentFor };
