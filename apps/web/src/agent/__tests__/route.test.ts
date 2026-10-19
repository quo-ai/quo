import { describe, expect, it } from 'vitest';
import { usesFolderLoop } from '../route';

const cloud = (extra: Record<string, unknown> = { agentLight: false }) => ({ kind: 'cloud', model: { id: 'x', name: 'M', agent: true, ...extra } }) as never;
const base = { available: true, autoStart: true, gated: false, plainFeatures: false };

describe('does a chat with no folder go through the tool loop?', () => {
  it('does for a capable model, with the setting on', () => {
    expect(usesFolderLoop({ ...base, choice: cloud() })).toBe(true);
    expect(usesFolderLoop({ ...base, choice: { kind: 'own', model: {}, provider: {} } as never })).toBe(true);
    expect(usesFolderLoop({ ...base, choice: { kind: 'local', model: {} } as never })).toBe(true);
  });

  it('keeps the ordinary route when Code mode is off, unavailable, or something the loop does not do is in play', () => {
    expect(usesFolderLoop({ ...base, choice: cloud(), autoStart: false })).toBe(false);
    expect(usesFolderLoop({ ...base, choice: cloud(), available: false })).toBe(false);
    expect(usesFolderLoop({ ...base, choice: cloud(), plainFeatures: true })).toBe(false);
  });

  it('leaves the decision to an offline model only when it is rated good at tools, even if the person allowed it for Code mode', () => {
    const local = { kind: 'local', model: {} } as never;
    expect(usesFolderLoop({ ...base, choice: local, localRated: true })).toBe(true);
    expect(usesFolderLoop({ ...base, choice: local, localRated: false })).toBe(false);
    expect(usesFolderLoop({ ...base, choice: cloud(), localRated: false })).toBe(true); // only about offline models
  });

  it('asks an untrusted offline model first, by not using the loop', () => {
    expect(usesFolderLoop({ ...base, choice: { kind: 'local', model: {} } as never, gated: true })).toBe(false);
  });

  it('does not send a cloud model to a server too old to know the protocol', () => {
    expect(usesFolderLoop({ ...base, choice: cloud({}) })).toBe(false);
    expect(usesFolderLoop({ ...base, choice: cloud({ agentLight: true }) })).toBe(true);
  });
});
