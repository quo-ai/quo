'use strict';

/**
 * When a model does not fit in memory with the window that was asked for, load it again with a smaller one instead of
 * giving up (Ollama does the same: its automatic context steps down and the load is retried). The window is halved, in
 * whole thousands, until the model loads or it would fall below what a chat needs. Only an out-of-memory failure is
 * retried; any other error is the real answer.
 */

const MIN_CONTEXT = 8192;

/** Calls `start(contextSize)`, halving the window after each out-of-memory failure. Resolves to what `start` returned. */
async function startWithFallback(start, contextSize, { min = MIN_CONTEXT, onRetry } = {}) {
  let size = contextSize;
  for (;;) {
    try {
      return await start(size);
    } catch (error) {
      if (error?.code !== 'out_of_memory' || size <= min) throw error;
      const next = Math.max(min, Math.floor(size / 2 / 1024) * 1024);
      onRetry?.(size, next);
      size = next;
    }
  }
}

module.exports = { startWithFallback, MIN_CONTEXT };
