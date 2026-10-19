'use strict';

/**
 * Lets go of the model when nobody is using it, so it stops holding gigabytes of memory (graphics memory on a card that a
 * game or an editor may want). Ollama unloads after 5 minutes; LM Studio's idle timer defaults to 60. The next message
 * loads it again, which takes a few seconds. Never while a reply is being written: every request counts as active from its
 * first byte to its last.
 */

const IDLE_MS = 30 * 60 * 1000;

class IdleWatch {
  /** @param {{ idleMs?: number, now?: () => number, onIdle: () => void }} options */
  constructor({ idleMs = IDLE_MS, now = Date.now, onIdle }) {
    this.idleMs = idleMs;
    this.now = now;
    this.onIdle = onIdle;
    this.active = 0;
    this.lastUsed = now();
    this.timer = null;
  }

  /** A request started. */
  begin() {
    this.active++;
    this.lastUsed = this.now();
  }

  /** A request finished (or was stopped). */
  end() {
    this.active = Math.max(0, this.active - 1);
    this.lastUsed = this.now();
  }

  /** The model was just loaded: the clock starts now. */
  reset() {
    this.active = 0;
    this.lastUsed = this.now();
  }

  /** True when nothing has been going on for the whole idle time. */
  isIdle() {
    return this.active === 0 && this.now() - this.lastUsed >= this.idleMs;
  }

  check() {
    if (this.isIdle()) this.onIdle();
  }

  /** Starts looking once a minute (or more often for a short idle time). */
  start(everyMs = Math.min(60_000, Math.max(1000, this.idleMs / 2))) {
    this.stop();
    this.reset();
    this.timer = setInterval(() => this.check(), everyMs);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

module.exports = { IdleWatch, IDLE_MS };
