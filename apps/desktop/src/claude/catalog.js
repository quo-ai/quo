'use strict';

const { KNOWN, nameOf, thinkingOf } = require('./models');
const { atLeast } = require('./session');

/**
 * Which models Claude Code offers this person, and each one's window. Claude Code's own rows (short names that always
 * mean the newest) come with its start-up report. Specific versions (models.js, and the exact models the short names
 * stand for) are checked one by one: Claude Code asks Anthropic about each (about a second apiece; no message is sent)
 * and says "not found" for any it can't use. That runs in the background, once per Claude Code version and sign-in,
 * and is kept for a day.
 */

const DAY = 86_400_000;
const CHECK_MS = 60_000;
// Older versions can't report a model's window without counting a whole conversation.
const CONTEXT_VERSION = '2.1.257';
const valid = id => typeof id === 'string' && /^[\w.:\[\]-]{1,80}$/.test(id);

/** Claude Code's own rows, default first. */
const rowsOf = init => (Array.isArray(init.models) ? init.models : []).filter(model => valid(model?.value)).sort((a, b) => Number(b.value === 'default') - Number(a.value === 'default'));
const canCheck = init => Boolean(init.claude_code_version && atLeast(init.claude_code_version, CONTEXT_VERSION));

/** The models as the page gets them; `sizes` holds the windows of those checked (a specific version is offered only once checked). */
function listOf(rows, sizes) {
  // How it thinks (models.js): what the person's Thinking choice can mean for it.
  const thinking = id => thinkingOf(id, rows);
  const window = id => (sizes.get(id) ? { contextTokens: sizes.get(id) } : {});
  const own = new Set(rows.map(row => row.value));
  const pinned = [...new Set([...KNOWN.map(model => model.id), ...rows.map(row => row.resolvedModel).filter(valid)])].filter(id => !own.has(id) && sizes.has(id));
  return [
    ...rows.map(row => ({ id: row.value, name: String(row.displayName || row.value).slice(0, 80), description: String(row.description ?? '').slice(0, 200), pinned: false, thinking: thinking(row.value), ...(valid(row.resolvedModel) ? { resolved: row.resolvedModel } : {}), ...window(row.value) })),
    ...pinned.map(id => {
      // What the short name for this exact model says about it, without the model's name: "Best for everyday, complex tasks".
      const said = rows.find(row => row.resolvedModel === id)?.description ?? '';
      return { id, name: nameOf(id), description: String(said).replace(/^[^·]*·\s*/, '').slice(0, 200), pinned: true, thinking: thinking(id), ...window(id) };
    }),
  ];
}

class ModelCatalog {
  constructor({ now = Date.now } = {}) {
    this.now = now;
    this.cache = new Map();
    this.running = null;
  }

  /** The full list if this version and sign-in were checked within a day, else null. */
  cached(key) {
    const hit = this.cache.get(key);
    return hit && this.now() - hit.at < DAY ? hit.models : null;
  }

  /** Checks every model with a Claude Code process of its own (`open` starts one), or joins the check already running. */
  check(key, open) {
    if (this.running?.key === key) return this.running.promise;
    const promise = (async () => {
      const { session, close } = await open();
      try {
        const init = await session.initializationResult();
        const rows = rowsOf(init);
        const sizes = new Map();
        if (canCheck(init)) {
          const ids = [...new Set([...rows.map(row => row.value), ...KNOWN.map(model => model.id), ...rows.map(row => row.resolvedModel).filter(valid)])];
          const deadline = this.now() + CHECK_MS;
          // The process starts on the default model, so that one is asked first, before switching.
          for (const id of ids) {
            if (this.now() > deadline) break;
            try {
              if (id !== 'default') await session.setModel(id);
              const usage = await session.getContextUsage({ detail: 'summary' });
              sizes.set(id, Number.isSafeInteger(usage?.rawMaxTokens) && usage.rawMaxTokens > 0 ? usage.rawMaxTokens : null);
            } catch {
              // Not a model this person can use through Claude Code.
            }
          }
        }
        const models = listOf(rows, sizes);
        this.cache.set(key, { at: this.now(), models });
        return models;
      } finally {
        close();
      }
    })().finally(() => {
      if (this.running?.promise === promise) this.running = null;
    });
    this.running = { key, promise };
    return promise;
  }

  /** The check running now, if any. */
  pending() {
    return this.running?.promise ?? null;
  }
}

module.exports = { ModelCatalog, listOf, rowsOf, canCheck };
