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

/**
 * Starts with the window stored as asked ('f16' or 'q8_0'). An 8-bit window needs flash attention, which a few devices
 * lack, so one that fails for any reason but a missing model is started once more in 16 bits. Resolves to what `run`
 * returned for the storage that worked.
 */
async function startWithCache(run, kvType) {
  const cache = kvType === 'q8_0' ? 'q8_0' : 'f16';
  try {
    return await run(cache);
  } catch (error) {
    if (cache === 'f16' || error?.code === 'model_missing') throw error;
    return run('f16');
  }
}

module.exports = { startWithFallback, startWithCache, MIN_CONTEXT };
