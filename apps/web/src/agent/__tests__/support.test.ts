import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../native', () => ({ agentBridge: () => ({}), hasNativeEngine: () => true }));
const { codeSupport } = await import('../support');

const cloud = (agent: boolean, name = 'GPT-6 Luna') => ({ kind: 'cloud', model: { id: 'x', name, agent } }) as never;
const own = (agent: boolean) => ({ kind: 'own', model: { id: 'y', name: 'Some Model', agent }, provider: {} }) as never;

describe('when Code mode is possible', () => {
  afterEach(() => vi.clearAllMocks());

  it('is possible with a cloud model marked able, and says nothing', () => {
    expect(codeSupport(cloud(true, 'Claude Sonnet 5.5'))).toEqual({ available: true, compact: false, gate: null });
  });

  it('is not possible with the free model, and says why in words that point to a fix', () => {
    const support = codeSupport(cloud(false));
    expect(support.available).toBe(false);
    expect(support.reason).toMatch(/GPT-6 Luna can’t work in a project folder/);
    expect(support.reason).toMatch(/stronger models/);
  });

  it('is not possible with an own-key model not marked for tools, and says so', () => {
    const support = codeSupport(own(false));
    expect(support.available).toBe(false);
    expect(support.reason).toMatch(/isn’t marked as able to use tools/);
  });

  it('gives no reason when there is simply no model', () => {
    expect(codeSupport(null).reason).toBeUndefined();
  });
});
