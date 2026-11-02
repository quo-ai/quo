'use strict';

const { ClaudeError } = require('./turn');

/**
 * What the page may send for a Claude Agent request: an id, a model's name, the conversation, the tool list, the
 * Thinking choice and whether it is a side call, each checked for shape and size and copied field by field. Nothing in
 * it can choose the program, its settings, its environment or where it connects.
 */

const LIMITS = { maxBytes: 16 * 1024 * 1024, maxMessages: 4000, maxTools: 64, maxCalls: 64, maxSchemaBytes: 64 * 1024, maxDescription: 8000 };
const ID = /^[A-Za-z0-9-]{8,64}$/;
const MODEL = /^[\w][\w.:\[\]-]{0,79}$/;
const TOOL_NAME = /^[a-z][a-z0-9_]{0,47}$/;
const CALL_ID = /^[\w-]{1,128}$/;
// The person's Thinking choice: one of Claude Code's efforts, Auto (its default), Off, or Quo's Quick and Deep (sessions.js).
const EFFORTS = ['off', 'auto', 'quick', 'deep', 'low', 'medium', 'high', 'xhigh', 'max'];

// An attached image: a data address the page made from the person's photo (apps/web/shared/content.ts), never a web address.
const IMAGE_DATA_URL = /^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;
const MAX_IMAGE_CHARS = 1_500_000;
const MAX_IMAGES = 8;

const bad = () => new ClaudeError('bad_request', 'That request isn’t valid.');
const isText = value => typeof value === 'string';
const isPlain = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** A user message's text and images, part by part. */
function parts(raw) {
  if (raw.length === 0 || raw.length > 20) throw bad();
  return raw.map(part => {
    if (isPlain(part) && part.type === 'text' && isText(part.text)) return { type: 'text', text: part.text };
    const url = isPlain(part) && part.type === 'image_url' && isPlain(part.image_url) ? part.image_url.url : null;
    if (!isText(url) || url.length > MAX_IMAGE_CHARS || !IMAGE_DATA_URL.test(url)) throw bad();
    return { type: 'image_url', image_url: { url } };
  });
}

function message(raw) {
  if (isPlain(raw) && raw.role === 'user' && Array.isArray(raw.content)) return { role: 'user', content: parts(raw.content) };
  if (!isPlain(raw) || !isText(raw.content)) throw bad();
  if (raw.role === 'system' || raw.role === 'user') return { role: raw.role, content: raw.content };
  if (raw.role === 'tool') {
    if (!isText(raw.tool_call_id) || !CALL_ID.test(raw.tool_call_id)) throw bad();
    return { role: 'tool', tool_call_id: raw.tool_call_id, content: raw.content };
  }
  if (raw.role !== 'assistant') throw bad();
  if (raw.tool_calls === undefined) return { role: 'assistant', content: raw.content };
  if (!Array.isArray(raw.tool_calls) || raw.tool_calls.length > LIMITS.maxCalls) throw bad();
  const calls = raw.tool_calls.map(call => {
    if (!isPlain(call) || !isText(call.id) || !CALL_ID.test(call.id) || !isPlain(call.function) || !isText(call.function.name) || !isText(call.function.arguments)) throw bad();
    return { id: call.id, type: 'function', function: { name: call.function.name.slice(0, 64), arguments: call.function.arguments } };
  });
  return { role: 'assistant', content: raw.content, ...(calls.length ? { tool_calls: calls } : {}) };
}

function tool(raw) {
  const fn = isPlain(raw) ? raw.function : null;
  if (!isPlain(fn) || !isText(fn.name) || !TOOL_NAME.test(fn.name) || !isText(fn.description) || fn.description.length > LIMITS.maxDescription) throw bad();
  if (!isPlain(fn.parameters) || fn.parameters.type !== 'object' || JSON.stringify(fn.parameters).length > LIMITS.maxSchemaBytes) throw bad();
  return { name: fn.name, description: fn.description, parameters: JSON.parse(JSON.stringify(fn.parameters)) };
}

function checkRequest(raw) {
  if (!isPlain(raw) || !isText(raw.id) || !ID.test(raw.id) || !isText(raw.model) || !MODEL.test(raw.model)) throw bad();
  if (!Array.isArray(raw.messages) || raw.messages.length === 0 || raw.messages.length > LIMITS.maxMessages) throw bad();
  if (raw.tools !== undefined && (!Array.isArray(raw.tools) || raw.tools.length > LIMITS.maxTools)) throw bad();
  const messages = raw.messages.map(message);
  const tools = (raw.tools ?? []).map(tool);
  if (new Set(tools.map(t => t.name)).size !== tools.length) throw bad();
  if (messages.reduce((sum, m) => sum + (Array.isArray(m.content) ? m.content.filter(part => part.type === 'image_url').length : 0), 0) > MAX_IMAGES) throw new ClaudeError('too_large', `Send up to ${MAX_IMAGES} images at a time.`);
  if (JSON.stringify(messages).length + JSON.stringify(tools).length > LIMITS.maxBytes) throw new ClaudeError('too_large', 'That conversation is too large to send.');
  if (raw.effort !== undefined && !EFFORTS.includes(raw.effort)) throw bad();
  if (raw.oneOff !== undefined && typeof raw.oneOff !== 'boolean') throw bad();
  return { id: raw.id, model: raw.model, messages, tools, ...(raw.effort ? { effort: raw.effort } : {}), oneOff: raw.oneOff === true };
}

module.exports = { checkRequest, LIMITS };
