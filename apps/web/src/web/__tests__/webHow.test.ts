import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ bridge: false, engine: false }));
vi.mock('../../native', () => ({ webBridge: () => (state.bridge ? {} : null), hasNativeEngine: () => state.engine }));
const { webHow } = await import('../support');

const cloud = (extra: Record<string, unknown>) => ({ kind: 'cloud', model: { id: 'x', agent: false, ...extra } }) as never;
const own = (agent: boolean, custom = false, id = 'openrouter') => ({ kind: 'own', model: { agent }, provider: { id, custom } }) as never;

describe('how a chat can search the web', () => {
  beforeEach(() => {
    state.bridge = false;
    state.engine = false;
  });

  it('is a switch with Quo’s own search in a browser, whatever the model', () => {
    expect(webHow(cloud({ agent: true, agentLight: false }), false)).toBe('native');
    expect(webHow(cloud({ agentLight: true, free: true }), false)).toBe('native');
  });

  it('is search tools the model decides to use, on the desktop, for every cloud model that can use tools', () => {
    state.bridge = true;
    expect(webHow(cloud({ agent: true, agentLight: false }), false)).toBe('tools');
    expect(webHow(cloud({ agentLight: true, free: true }), false)).toBe('tools');
  });

  it('keeps Quo’s own search on the desktop for a model that cannot use tools, and for a server that does not know the new protocol', () => {
    state.bridge = true;
    expect(webHow(cloud({ agent: false, agentLight: false }), false)).toBe('native');
    expect(webHow(cloud({ agent: true }), false)).toBe('native'); // no agentLight key: an older server
    expect(webHow(cloud({ agent: true }), true)).toBe('tools'); // …except inside Code mode, as before
  });

  it('is tools for an own-key model marked for tools and for offline models on the desktop', () => {
    state.bridge = true;
    state.engine = true;
    expect(webHow(own(true), false)).toBe('tools');
    expect(webHow(own(false), false)).toBe('native');
    expect(webHow({ kind: 'local', model: {} } as never, false)).toBe('tools');
  });
});
