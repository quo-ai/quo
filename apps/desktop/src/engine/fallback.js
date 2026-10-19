'use strict';

/**
 * When a model does not fit in memory, load it again with less instead of giving up (Ollama retries a failed load the
 * same way). The first retry keeps the image projector on the processor (it is a fixed cost that does not shrink with the
 * window, and a picture is slower but still works); after that the window is halved, in whole thousands, until the
 * model loads or it would fall below what a chat needs. Only an out-of-memory failure is retried; any other error is the
 * real answer.
 */

const MIN_CONTEXT = 8192;

/**
 * Calls `start(contextSize, { cpuProjector })`, retrying out-of-memory failures with less. Resolves to what `start`
 * returned. `onRetry(from, to, what)` hears about each retry (`what` is 'projector' or 'window').
 */
async function startWithFallback(start, contextSize, { hasProjector = false, min = MIN_CONTEXT, onRetry } = {}) {
  let size = contextSize;
  let cpuProjector = false;
  for (;;) {
    try {
      return await start(size, { cpuProjector });
    } catch (error) {
      if (error?.code !== 'out_of_memory') throw error;
      if (hasProjector && !cpuProjector) {
        cpuProjector = true;
        onRetry?.(size, size, 'projector');
        continue;
      }
      if (size <= min) throw error;
      const next = Math.max(min, Math.floor(size / 2 / 1024) * 1024);
      onRetry?.(size, next, 'window');
      size = next;
    }
  }
}

module.exports = { startWithFallback, MIN_CONTEXT };
