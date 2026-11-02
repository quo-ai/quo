import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installLocalStorage } from './helpers';

installLocalStorage();

describe('Claude plan usage', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it('keeps what the last reply reported, with when', async () => {
    const { noteUsage } = await import('../claudeUsage');
    noteUsage({ status: 'allowed', windows: [{ id: 'five_hour', used: 24, resetsAt: 1 }], extra: 'off' });
    noteUsage(undefined);
    const saved = JSON.parse(localStorage.getItem('quo.claudeUsage')!);
    expect(saved).toMatchObject({ windows: [{ id: 'five_hour', used: 24 }], extra: 'off' });
    expect(typeof saved.at).toBe('number');
  });

  it('the window that matters next is the fullest one that hasn’t reset', async () => {
    const { tightest, windowName } = await import('../claudeUsage');
    const now = 1_000_000;
    const usage = { status: null, extra: null, at: now, windows: [{ id: 'five_hour', used: 90, resetsAt: now - 1 }, { id: 'seven_day', used: 45, resetsAt: now + 1 }, { id: 'seven_day_opus', used: 60, resetsAt: null }] };
    expect(tightest(usage, now)).toMatchObject({ id: 'seven_day_opus', used: 60 });
    expect(windowName('five_hour')).toEqual(['5-hour limit', '5h']);
    expect(windowName('seven_day_fable')[0]).toBe('seven day fable');
  });

  it('names the exact model behind a short name, and nothing when the name already is the id', async () => {
    const { exactModel } = await import('../claudeCatalog');
    const offered = [{ id: 'sonnet', name: 'Sonnet', description: '', resolved: 'claude-sonnet-5-5' }];
    expect(exactModel({ name: 'Sonnet', apiModel: 'sonnet' }, offered)).toBe('claude-sonnet-5-5');
    expect(exactModel({ name: 'Claude Opus 4.8', apiModel: 'claude-opus-4-8' }, offered)).toBe('claude-opus-4-8');
    expect(exactModel({ name: 'gpt-5', apiModel: 'gpt-5' })).toBeNull();
  });
});
