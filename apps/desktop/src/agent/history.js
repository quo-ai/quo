'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');
const { AgentError, resolveInside } = require('./safety');
const { sha } = require('./files/limits');

/**
 * What this session has changed, so the user can take the last changes back with one
 * click. Each entry keeps the text before and after; undoing a change only goes ahead if
 * the file is still exactly as the agent left it, so anything the user did to it since is
 * never overwritten. Held in memory for the life of the session, and bounded.
 */

const MAX_ENTRIES = 200;
const MAX_BYTES = 24 * 1024 * 1024;

class ChangeLog {
  constructor() {
    this.entries = [];
    this.bytes = 0;
  }

  get size() {
    return this.entries.length;
  }

  /** Remembers a change just made: `before` is null for a file that didn't exist. */
  record({ relative, before, after }) {
    const entry = { relative, before, after, bytes: Buffer.byteLength(before ?? '') + Buffer.byteLength(after) };
    this.entries.push(entry);
    this.bytes += entry.bytes;
    while (this.entries.length > MAX_ENTRIES || (this.bytes > MAX_BYTES && this.entries.length > 1)) this.bytes -= this.entries.shift().bytes;
  }

  /**
   * Takes back the last `count` changes, newest first. Returns what was restored and
   * what was left alone (the file was changed again since, or can't be reached).
   */
  async undo(ctx, count = 1) {
    const restored = [];
    const skipped = [];
    const wanted = Math.max(0, Math.min(Math.trunc(Number(count)) || 0, this.entries.length));
    for (let i = 0; i < wanted; i++) {
      const entry = this.entries.pop();
      this.bytes -= entry.bytes;
      try {
        const { absolute } = resolveInside(ctx.rootReal, entry.relative, { allowMissing: true });
        const current = await fsp.readFile(absolute, 'utf8').catch(error => (error.code === 'ENOENT' ? null : Promise.reject(error)));
        if (current === null && entry.before === null) continue; // already gone
        if (current === null || sha(current) !== sha(entry.after)) {
          skipped.push(entry.relative);
          continue;
        }
        if (entry.before === null) await fsp.rm(absolute, { force: true });
        else {
          await fsp.mkdir(path.dirname(absolute), { recursive: true });
          await fsp.writeFile(absolute, entry.before, 'utf8');
        }
        ctx.reads.delete(absolute); // the model has to read it again before touching it
        restored.push(entry.relative);
      } catch (error) {
        if (error instanceof AgentError || error.code) skipped.push(entry.relative);
        else throw error;
      }
    }
    return { restored, skipped };
  }
}

module.exports = { ChangeLog };
