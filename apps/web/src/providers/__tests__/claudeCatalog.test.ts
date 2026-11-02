import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClaudeModel, ClaudeStatus, DesktopClaude } from '../../native';
import { installLocalStorage } from './helpers';

vi.mock('../../ui/Toasts', () => ({ toast: () => {} }));
installLocalStorage();

const opus: ClaudeModel = { id: 'opus', name: 'Opus', description: 'Opus 5.5', thinking: { efforts: ['low', 'high'], default: 'medium', off: false }, resolved: 'claude-opus-5-5' };
const pinned: ClaudeModel = { id: 'claude-opus-4-8', name: 'Claude Opus 4.8', description: '', pinned: true, thinking: { efforts: ['low', 'medium', 'high', 'xhigh', 'max'], default: 'high', off: true }, contextTokens: 1_000_000 };

function install(status: ClaudeStatus, full: ClaudeModel[] | null) {
  let release!: () => void;
  const ready = new Promise<void>(resolve => {
    release = resolve;
  });
  const bridge: DesktopClaude = {
    status: vi.fn(async () => ({ ok: status })),
    models: vi.fn(async () => {
      await ready;
      return { ok: full };
    }),
    request: vi.fn(),
    abort: vi.fn(),
    onEvent: () => () => {},
  };
  (globalThis as { window?: unknown }).window = { quoDesktop: { claude: bridge } };
  return { bridge, release };
}

describe('Claude Agent’s model list', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it('lists Claude Code’s own rows at once, keeps known versions while they are checked, then the full list', async () => {
    localStorage.setItem('quo.claudeModels', JSON.stringify({ models: [opus, { ...pinned, id: 'claude-opus-4-7', name: 'Claude Opus 4.7' }], at: 1 }));
    const { release } = install({ installed: true, signedIn: true, models: [opus], checking: true }, [opus, pinned]);
    const { refreshClaudeModels } = await import('../claudeCatalog');
    const seen: ClaudeStatus[] = [];
    const done = refreshClaudeModels(status => seen.push(status));
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    expect(JSON.parse(localStorage.getItem('quo.claudeModels')!).models.map((m: ClaudeModel) => m.id)).toEqual(['opus', 'claude-opus-4-7']);
    release();
    const final = await done;
    expect(final.checking).toBe(false);
    expect(JSON.parse(localStorage.getItem('quo.claudeModels')!).models.map((m: ClaudeModel) => m.id)).toEqual(['opus', 'claude-opus-4-8']);
  });

  it('updates the window and Thinking of models already added', async () => {
    const { addOwnModel, getOwnModel } = await import('../ownModels');
    const { CLAUDE_AGENT } = await import('../claudeAgent');
    addOwnModel(CLAUDE_AGENT, 'claude-opus-4-8');
    install({ installed: true, signedIn: true, models: [opus, pinned] }, null);
    const { refreshClaudeModels } = await import('../claudeCatalog');
    await refreshClaudeModels();
    expect(getOwnModel('claude-agent:claude-opus-4-8')).toMatchObject({ contextTokens: 1_000_000, thinking: ['off', 'low', 'medium', 'high', 'xhigh', 'max'], thinkingDefault: 'high' });
  });

  it('asks in the background only for someone who uses Claude Agent, and only when the list is a day old', async () => {
    const { bridge } = install({ installed: true, signedIn: true, models: [opus] }, null);
    const first = await import('../claudeCatalog');
    first.refreshClaudeModelsIfOld();
    expect(bridge.status).not.toHaveBeenCalled();
    localStorage.setItem('quo.claudeModels', JSON.stringify({ models: [opus], at: Date.now() }));
    vi.resetModules();
    const fresh = await import('../claudeCatalog');
    fresh.refreshClaudeModelsIfOld();
    expect(bridge.status).not.toHaveBeenCalled();
    localStorage.setItem('quo.claudeModels', JSON.stringify({ models: [opus], at: 1 }));
    vi.resetModules();
    const old = await import('../claudeCatalog');
    old.refreshClaudeModelsIfOld();
    old.refreshClaudeModelsIfOld();
    expect(bridge.status).toHaveBeenCalledTimes(1);
  });

  it('refreshes a list from before short names carried their exact model, even when it is new', async () => {
    const { bridge } = install({ installed: true, signedIn: true, models: [opus] }, null);
    localStorage.setItem('quo.claudeModels', JSON.stringify({ models: [{ ...opus, resolved: undefined }], at: Date.now() }));
    const { refreshClaudeModelsIfOld } = await import('../claudeCatalog');
    refreshClaudeModelsIfOld();
    expect(bridge.status).toHaveBeenCalledTimes(1);
  });

  it('refreshes a list saved before models said how they think', async () => {
    const { bridge } = install({ installed: true, signedIn: true, models: [opus] }, null);
    localStorage.setItem('quo.claudeModels', JSON.stringify({ models: [{ ...opus, thinking: undefined }], at: Date.now() }));
    const { refreshClaudeModelsIfOld } = await import('../claudeCatalog');
    refreshClaudeModelsIfOld();
    expect(bridge.status).toHaveBeenCalledTimes(1);
  });
});
