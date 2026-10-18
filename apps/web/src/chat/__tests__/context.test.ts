import { describe, expect, it } from 'vitest';
import { buildContext, estimateTokens } from '../context';

const SYSTEM = 'system prompt';
const msg = (role: 'user' | 'assistant', content: string) => ({ role, content });

describe('buildContext', () => {
  it('keeps the whole conversation when it fits', () => {
    const turns = [msg('user', 'hi'), msg('assistant', 'hello'), msg('user', 'how are you?')];
    const context = buildContext(SYSTEM, turns, 8192, 2048);
    expect(context).toEqual([{ role: 'system', content: SYSTEM }, ...turns]);
  });

  it('drops the oldest turns first when over budget', () => {
    const long = 'x'.repeat(3500); // ~1,006 tokens each
    const turns = Array.from({ length: 10 }, (_, i) => msg(i % 2 ? 'assistant' : 'user', `${i}${long}`));
    const context = buildContext(SYSTEM, turns, 4096, 1024);
    const kept = context.slice(1);
    expect(kept.length).toBeLessThan(turns.length);
    expect(kept[kept.length - 1].content).toBe(turns[turns.length - 1].content);
    const used = kept.reduce((sum, turn) => sum + estimateTokens(turn.content), 0);
    expect(used).toBeLessThanOrEqual(4096 - 1024);
  });

  it('never starts the history with an orphaned assistant reply', () => {
    const long = 'y'.repeat(3500);
    const turns = [msg('user', long), msg('assistant', long), msg('user', long), msg('assistant', 'short'), msg('user', 'last')];
    const context = buildContext(SYSTEM, turns, 2900, 512);
    expect(context[1].role).toBe('user');
  });

  it('truncates a single oversized newest message instead of dropping it', () => {
    const huge = 'z'.repeat(100_000);
    const context = buildContext(SYSTEM, [msg('user', huge)], 4096, 1024);
    expect(context).toHaveLength(2);
    expect(context[1].role).toBe('user');
    expect(context[1].content.length).toBeGreaterThan(0);
    expect(estimateTokens(context[1].content)).toBeLessThanOrEqual(4096 - 1024);
  });

  it('skips empty messages (e.g. a reply still being written)', () => {
    const context = buildContext(SYSTEM, [msg('user', 'q'), msg('assistant', '')], 8192, 2048);
    expect(context).toHaveLength(2);
  });
});
