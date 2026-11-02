'use strict';

/**
 * The specific Claude models Quo offers through Claude Code, next to Claude Code's own short names (`opus`, `sonnet`,
 * …, which always mean the newest). Each one is checked with Claude Code when the person opens Claude Agent: it says
 * "not found" for a model it doesn't know and gives each one's window, so a retired entry simply drops out, and a newer
 * model still appears through the short names, whose exact model Claude Code reports.
 *
 * How each model thinks, as Claude Code runs it (read from Claude Code 2.1.303's own model table): the efforts it takes,
 * the effort Claude Code uses when none is chosen, and whether thinking can be turned off (`rejects_disabled_thinking`
 * models can't). Claude Code reports the efforts of its own rows itself; those win. Add new models here.
 */

const ALL = ['low', 'medium', 'high', 'xhigh', 'max'];
const TO_MAX = ['low', 'medium', 'high', 'max'];
const KNOWN = [
  { id: 'claude-fable-5-1', efforts: ALL, default: 'high', off: false },
  { id: 'claude-fable-5', efforts: ALL, default: 'high', off: false },
  { id: 'claude-opus-5-5', efforts: ALL, default: 'medium', off: false },
  { id: 'claude-opus-5', efforts: ALL, default: 'high', off: true },
  { id: 'claude-opus-4-8', efforts: ALL, default: 'high', off: true },
  { id: 'claude-opus-4-7', efforts: ALL, default: 'xhigh', off: true },
  { id: 'claude-opus-4-6', efforts: TO_MAX, default: 'high', off: true },
  { id: 'claude-opus-4-5', efforts: ['low', 'medium', 'high'], default: 'high', off: false },
  { id: 'claude-sonnet-5-5', efforts: ALL, default: 'medium', off: false },
  { id: 'claude-sonnet-5', efforts: ALL, default: 'high', off: true },
  { id: 'claude-sonnet-4-6', efforts: TO_MAX, default: 'high', off: true },
  { id: 'claude-sonnet-4-5', efforts: [], default: null, off: false },
  { id: 'claude-haiku-5-5', efforts: ALL, default: 'medium', off: false },
  { id: 'claude-haiku-4-5', efforts: [], default: null, off: false },
];
const BY_ID = new Map(KNOWN.map(model => [model.id, model]));

/** "claude-opus-5-5" → "Claude Opus 5.5". */
function nameOf(id) {
  const match = /^claude-([a-z]+)-([\d-]+)$/.exec(id);
  if (!match) return id;
  return `Claude ${match[1][0].toUpperCase()}${match[1].slice(1)} ${match[2].split('-').join('.')}`;
}

/**
 * How a model thinks: its efforts, Claude Code's default effort for it, and whether thinking can be turned off. A short
 * name takes the facts of the exact model it stands for; `reported` is Claude Code's own rows (their efforts win).
 */
function thinkingOf(model, reported = []) {
  const row = reported.find(listed => listed.value === model) ?? reported.find(listed => listed.resolvedModel === model);
  const known = BY_ID.get(row?.resolvedModel ?? model) ?? BY_ID.get(model);
  const efforts = row ? (row.supportsEffort === false ? [] : (row.supportedEffortLevels ?? known?.efforts ?? [])) : (known?.efforts ?? []);
  return { efforts: efforts.filter(effort => ALL.includes(effort)), default: known?.default ?? null, off: known?.off ?? false };
}

module.exports = { KNOWN, nameOf, thinkingOf };
