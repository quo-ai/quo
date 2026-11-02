'use strict';

const crypto = require('node:crypto');
const { markOf, carryOn, contentFor } = require('./history');
const { thinkingOf } = require('./models');
const { effortFor, sessionOptions } = require('./options');
const { startSession } = require('./session');
const { PendingTools, toolHooks, toolServer } = require('./tools');
const { ClaudeError, problemFor, readReply } = require('./turn');

/**
 * The live Claude Code processes, one per conversation. A request is matched to the process that has seen how it
 * starts (history.js) and carries on there: a new turn, or the results of the tool calls that process is waiting
 * for. A process that has been idle a while stops, but its conversation is kept (`saved`) and picked up again by
 * the next message, the way Claude Code resumes a session. Only a few run at once. Side calls (summaries) get a
 * process of their own that stops when they're answered. Transcripts are deleted once Quo is done with them.
 */

const LIMITS = {
  maxLive: 3,
  maxSaved: 20,
  idleMs: 5 * 60_000,
  // Waiting while Quo runs the tools: approvals take as long as the person likes.
  waitingMs: 30 * 60_000,
  startMs: 30_000,
};

const keyOf = (system, tools) => crypto.createHash('sha256').update(JSON.stringify([system, tools])).digest('hex');
const aborted = () => new ClaudeError('aborted', 'Stopped.');

class ClaudeSessions {
  /**
   * @param {object} deps
   * @param {() => object} deps.base  The options every process starts with (options.js baseOptions), or throws if Claude Code is missing.
   * @param {typeof startSession} [deps.start]
   * @param {(sessionId: string) => Promise<void>} [deps.forget]  Deletes a conversation's transcript.
   * @param {() => Promise<void>} [deps.sweep]  Deletes transcripts left from before (Quo stopped without tidying up).
   */
  constructor({ base, start = startSession, forget = async () => {}, sweep = async () => {}, limits = {} }) {
    this.base = base;
    this.start = start;
    this.forget = id => forget(id).catch(() => {});
    this.sweep = sweep;
    this.swept = null;
    this.limits = { ...LIMITS, ...limits };
    this.entries = new Set();
    this.saved = new Set();
  }

  /** Answers one request: returns the reply, with its words also passed to `onUpdate` as they come. */
  async run({ id, model, messages, tools, effort, oneOff = false }, onUpdate) {
    const system = messages.filter(message => message.role === 'system').map(message => message.content).join('\n\n');
    const rest = messages.filter(message => message.role !== 'system');
    const marks = rest.map(markOf);
    const key = keyOf(system, tools);

    let { entry, plan } = oneOff ? {} : this.find(this.entries, key, marks, candidate => !candidate.busy && !candidate.session.ended);
    if (!entry) {
      const saved = oneOff ? {} : this.find(this.saved, key, marks);
      if (saved.entry) {
        this.saved.delete(saved.entry);
        entry = await this.open({ key, model, system, tools, resume: saved.entry.sessionId }).catch(() => null);
        if (entry) [entry.seen, entry.stopped, plan] = [saved.entry.seen, saved.entry.stopped, saved.plan];
        else this.forget(saved.entry.sessionId);
      }
      if (!entry) {
        plan = null;
        await this.retire(key, marks);
        entry = await this.open({ key, model, system, tools, oneOff });
      }
    }
    entry.busy = id;
    clearTimeout(entry.timer);
    try {
      if (entry.model !== model) {
        await entry.session.setModel(model);
        entry.model = model;
      }
      // The person's Thinking choice: an effort, or no thinking where the model allows it (models.js).
      const spec = thinkingOf(model, entry.models);
      const level = effortFor(effort, spec.efforts);
      const off = effort === 'off' && spec.off;
      if (entry.effort !== level) {
        await entry.session.setEffort(level);
        entry.effort = level;
      }
      if (entry.thinkingOff !== off) {
        await entry.session.setThinkingOff(off);
        entry.thinkingOff = off;
      }
      if (plan?.interrupt) {
        // The person stopped while Quo ran the tools, and wrote again: end the waiting turn first.
        await entry.session.interrupt();
        entry.pending.clear();
      }
      if (plan?.kind === 'results') {
        const extra = rest.slice(plan.end);
        if (extra.length) entry.session.addUser(contentFor(extra));
        for (let i = plan.start; i < plan.end; i++) entry.pending.resolve(rest[i].tool_call_id, rest[i].content);
      } else entry.session.begin(contentFor(rest.slice(plan?.start ?? 0)));

      const reply = await readReply(entry.session, { tools: entry.tools, pending: entry.pending, onUpdate });
      if (entry.aborted) throw aborted();
      const echo = { role: 'assistant', content: reply.content, ...(reply.toolCalls.length ? { tool_calls: reply.toolCalls.map(call => ({ id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments } })) } : {}) };
      Object.assign(entry, { seen: [...marks, markOf(echo)], waiting: reply.finish === 'tool_calls' ? reply.toolCalls.map(call => call.id) : null, stopped: false, busy: null, used: Date.now() });
      if (entry.oneOff) await this.close(entry);
      else this.arm(entry);
      return reply;
    } catch (error) {
      if (entry.aborted && !entry.session.ended && !entry.oneOff) {
        // Stopped by the person: Claude Code has written down what it had, and the conversation carries on from there.
        entry.pending.clear();
        Object.assign(entry, { seen: marks, waiting: null, stopped: true, busy: null, aborted: false, used: Date.now() });
        this.arm(entry);
        throw aborted();
      }
      await this.close(entry);
      if (entry.aborted) throw aborted();
      throw error instanceof ClaudeError ? error : problemFor(null, error?.message);
    }
  }

  /** The candidate in `pool` that this request carries on from furthest, and how. */
  find(pool, key, marks, usable = () => true) {
    let best = {};
    for (const candidate of pool) {
      if (candidate.key !== key || !usable(candidate)) continue;
      const plan = carryOn(candidate.seen, candidate.waiting ?? null, marks, candidate.stopped);
      if (plan && (!best.plan || (plan.end ?? plan.start) > (best.plan.end ?? best.plan.start))) best = { entry: candidate, plan };
    }
    return best;
  }

  /** A process for a conversation, once it has started and checked in. `resume` picks up a saved conversation. */
  async open({ key, model, system, tools, oneOff = false, resume }) {
    await (this.swept ??= this.sweep().catch(() => {}));
    if (!oneOff) {
      const idle = [...this.entries].filter(entry => !entry.busy && !entry.oneOff).sort((a, b) => a.used - b.used);
      while ([...this.entries].filter(entry => !entry.oneOff).length >= this.limits.maxLive) {
        const oldest = idle.shift();
        if (!oldest) throw new ClaudeError('busy', 'Claude Code is already answering in several chats. Wait for one to finish.');
        await this.close(oldest, { save: true });
      }
    }
    const pending = new PendingTools();
    const options = sessionOptions({ base: this.base(), model, system: system || undefined, server: tools.length ? toolServer(tools, pending) : null, hooks: toolHooks(pending), persist: !oneOff, resume });
    const session = await this.start(options);
    const entry = { key, model, tools, session, pending, seen: [], waiting: null, stopped: false, busy: null, used: Date.now(), timer: null, aborted: false, effort: null, thinkingOff: false, models: [], oneOff };
    this.entries.add(entry);
    try {
      const init = await Promise.race([
        session.ready,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Claude Code didn’t start within 30 seconds.')), this.limits.startMs).unref?.()),
      ]);
      entry.models = Array.isArray(init?.models) ? init.models : [];
    } catch (error) {
      await this.close(entry);
      throw new ClaudeError('claude_failed', error.message);
    }
    return entry;
  }

  /** Drops this conversation's other processes and saved copies (it was edited, or stopped part-way), and their transcripts. */
  async retire(key, marks) {
    const same = candidate => candidate.key === key && candidate.seen[0] && marks[0] && candidate.seen[0].print === marks[0].print;
    for (const entry of [...this.entries]) if (!entry.busy && same(entry)) await this.close(entry);
    for (const saved of [...this.saved]) {
      if (!same(saved)) continue;
      this.saved.delete(saved);
      this.forget(saved.sessionId);
    }
  }

  arm(entry) {
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => void this.close(entry, { save: !entry.waiting }), entry.waiting ? this.limits.waitingMs : this.limits.idleMs);
    entry.timer.unref?.();
  }

  /** Stops a process. `save` keeps its conversation to pick up again; otherwise its transcript is deleted. */
  async close(entry, { save = false } = {}) {
    clearTimeout(entry.timer);
    if (!this.entries.delete(entry)) return;
    await entry.session.stop().catch(() => {});
    entry.pending.clear();
    const sessionId = entry.session.id;
    if (!sessionId) return;
    if (!save || entry.waiting || entry.seen.length === 0) return this.forget(sessionId);
    this.saved.add({ key: entry.key, seen: entry.seen, stopped: entry.stopped, sessionId, used: entry.used });
    while (this.saved.size > this.limits.maxSaved) {
      const oldest = [...this.saved].sort((a, b) => a.used - b.used)[0];
      this.saved.delete(oldest);
      this.forget(oldest.sessionId);
    }
  }

  /** Stops the request with this id. The turn is interrupted and the process carries on; one that won't stop is ended. */
  abort(id) {
    for (const entry of this.entries) {
      if (entry.busy !== id) continue;
      entry.aborted = true;
      entry.session.interrupt().catch(() => this.close(entry));
    }
  }

  /** When Quo quits: every process stops and every transcript is deleted. */
  async closeAll() {
    await Promise.all([...this.entries].map(entry => this.close(entry)));
    await Promise.all([...this.saved].map(saved => this.forget(saved.sessionId)));
    this.saved.clear();
  }
}

module.exports = { ClaudeSessions, LIMITS };
