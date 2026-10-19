import { describe, expect, it, vi } from 'vitest';

vi.mock('../../native', () => ({ hasNativeEngine: () => true, nativeBridge: () => null }));
const { reliabilityNote } = await import('../reliability');

describe('the note under a reply from a small offline model', () => {
  it('is there for the small ones, which are the ones that invent facts', () => {
    for (const id of ['qwen35-4b', 'gemma4-e2b', 'llama32-3b', 'phi4-mini']) expect(reliabilityNote(id), id).toBe('small model: check facts');
  });

  it('is there for the 9B too, which still pairs events with the wrong dates, in softer words', () => {
    expect(reliabilityNote('qwen35-9b')).toBe('offline model: check facts');
  });

  it('is not there for the largest, an unknown model, or a reply with no model', () => {
    expect(reliabilityNote('qwen35-27b')).toBeNull();
    expect(reliabilityNote('some-cloud-model')).toBeNull();
    expect(reliabilityNote(undefined)).toBeNull();
  });
});
