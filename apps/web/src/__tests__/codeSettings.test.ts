import { describe, expect, it, vi } from 'vitest';
import { installLocalStorage } from '../providers/__tests__/helpers';

installLocalStorage();

async function fresh() {
  vi.resetModules();
  return import('../codeSettings');
}

describe('Code mode settings', () => {
  it('start the way Code mode always worked', async () => {
    localStorage.clear();
    const { codeSettings, DEFAULT_CODE_SETTINGS } = await fresh();
    expect(codeSettings()).toEqual(DEFAULT_CODE_SETTINGS);
    expect(DEFAULT_CODE_SETTINGS).toEqual({ autoReadOnly: true, autoStart: true, creditQuo: true, allowPush: true, useNotes: true, startInPlan: false, maxSteps: 40 });
  });

  it('keep what is changed, across a reload, and tell listeners', async () => {
    localStorage.clear();
    const first = await fresh();
    first.setCodeSettings({ startInPlan: true, maxSteps: 10 });
    first.setCodeSettings({ autoReadOnly: false });
    expect(first.codeSettings()).toEqual({ autoReadOnly: false, autoStart: true, creditQuo: true, allowPush: true, useNotes: true, startInPlan: true, maxSteps: 10 });
    const second = await fresh();
    expect(second.codeSettings()).toEqual({ autoReadOnly: false, autoStart: true, creditQuo: true, allowPush: true, useNotes: true, startInPlan: true, maxSteps: 10 });
  });

  it('ignore anything in storage that isn’t a valid choice', async () => {
    localStorage.setItem('quo.codeSettings', JSON.stringify({ autoReadOnly: 'yes', autoStart: 'yes', creditQuo: 'no', allowPush: 'off', useNotes: 0, startInPlan: null, maxSteps: 7000 }));
    expect((await fresh()).codeSettings()).toEqual({ autoReadOnly: true, autoStart: true, creditQuo: true, allowPush: true, useNotes: true, startInPlan: false, maxSteps: 40 });
    localStorage.setItem('quo.codeSettings', '{broken');
    expect((await fresh()).codeSettings().maxSteps).toBe(40);
  });
});
