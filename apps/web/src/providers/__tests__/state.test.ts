import { beforeEach, describe, expect, it, vi } from 'vitest';
import { askOwnAgentModel } from '../../agent/own';
import { connectProvider, disconnectProvider, providerById, providerSnapshot, refreshProviders, removeCustomProvider, saveCustomProvider } from '../accounts';
import { connectAndCheck } from '../connect';
import { addOwnModel, getOwnModel, ownModelId, ownModels, removeOwnModel, removeProviderModels, setOwnModelAgent } from '../ownModels';
import { ProviderError } from '../errors';
import { builtInProvider } from '../registry';
import type { Transport } from '../transport';
import { ANTHROPIC, CUSTOM, OPENAI, installLocalStorage, streamOf } from './helpers';

installLocalStorage();

// Built at run time so no real-looking key sits in the source.
const KEY = `${'sk'}-${'test'}-${'abcdefghijkl1234'}`;

beforeEach(async () => {
  localStorage.clear();
  vi.resetModules();
  await refreshProviders();
});

describe('which providers are connected (in a browser)', () => {
  it('starts with every built-in provider unconnected', () => {
    const { accounts, storage, ready } = providerSnapshot();
    expect(ready).toBe(true);
    expect(storage).toBe('browser');
    expect(accounts.map(a => a.info.id)).toContain('anthropic');
    expect(accounts.every(a => !a.configured && a.last4 === null)).toBe(true);
  });

  it('saves a key and shows only its last four characters, then takes it away', async () => {
    await connectProvider('openai', KEY);
    expect(providerSnapshot().accounts.find(a => a.info.id === 'openai')).toMatchObject({ configured: true, last4: '1234' });
    await disconnectProvider('openai');
    expect(providerSnapshot().accounts.find(a => a.info.id === 'openai')?.configured).toBe(false);
  });

  it('refuses text that isn’t a key', async () => {
    for (const bad of ['', 'short', 'has a space in it', `${KEY}\nx: y`]) await expect(connectProvider('openai', bad)).rejects.toThrow(/doesn’t look like an API key/);
    expect(providerSnapshot().accounts.find(a => a.info.id === 'openai')?.configured).toBe(false);
  });

  it('adds, finds, changes and removes a server of the user’s own', async () => {
    const added = await saveCustomProvider({ name: 'Ollama', baseUrl: 'http://localhost:11434/v1/', protocol: 'openai' });
    expect(added).toMatchObject({ custom: true, baseUrl: 'http://localhost:11434/v1', protocol: 'openai', name: 'Ollama' });
    expect(providerById(added.id)).toEqual(added);
    expect(providerSnapshot().accounts.find(a => a.info.id === added.id)?.configured).toBe(false);
    await saveCustomProvider({ id: added.id, name: 'Local Ollama', baseUrl: 'http://localhost:11434/v1', protocol: 'openai', key: KEY });
    expect(providerById(added.id)?.name).toBe('Local Ollama');
    expect(providerSnapshot().accounts.find(a => a.info.id === added.id)?.configured).toBe(true);
    await removeCustomProvider(added.id);
    expect(providerById(added.id)).toBeUndefined();
  });

  it('takes a server’s key away when its address changes, but not when only its name does', async () => {
    const added = await saveCustomProvider({ name: 'Mine', baseUrl: 'https://llm.example.com/v1', protocol: 'openai', key: KEY });
    await saveCustomProvider({ id: added.id, name: 'Renamed', baseUrl: 'https://llm.example.com/v1', protocol: 'openai' });
    expect(providerSnapshot().accounts.find(a => a.info.id === added.id)?.configured).toBe(true);
    await saveCustomProvider({ id: added.id, name: 'Renamed', baseUrl: 'https://elsewhere.example.com/v1', protocol: 'openai' });
    expect(providerSnapshot().accounts.find(a => a.info.id === added.id)?.configured).toBe(false);
  });

  it('refuses an unsafe address or an empty name', async () => {
    await expect(saveCustomProvider({ name: 'x', baseUrl: 'http://example.com/v1', protocol: 'openai' })).rejects.toThrow(/won’t work/);
    await expect(saveCustomProvider({ name: '  ', baseUrl: 'https://example.com/v1', protocol: 'openai' })).rejects.toThrow(/name/);
  });
});

describe('connecting a key', () => {
  const transport = (status: number, body: string): Transport => ({ send: async () => ({ status, ok: status < 300, body: streamOf(body) }) });
  const offline: Transport = { send: async () => { throw new ProviderError(0, 'offline', 'offline', 'openai'); } };
  const openai = builtInProvider('openai')!;
  const connected = () => providerSnapshot().accounts.find(a => a.info.id === 'openai')?.configured;

  it('keeps a key the provider accepts, and returns what it offers', async () => {
    const models = await connectAndCheck(openai, KEY, transport(200, JSON.stringify({ data: [{ id: 'gpt-x' }] })));
    expect(models).toEqual([{ id: 'gpt-x', name: 'gpt-x' }]);
    expect(connected()).toBe(true);
  });

  it('takes a refused key straight back out, so a typo isn’t left saved', async () => {
    await expect(connectAndCheck(openai, KEY, transport(401, '{"error":{"message":"Incorrect API key"}}'))).rejects.toMatchObject({ code: 'provider_auth' });
    expect(connected()).toBe(false);
  });

  it('keeps the key when the check can’t be made', async () => {
    expect(await connectAndCheck(openai, KEY, offline)).toEqual([]);
    expect(connected()).toBe(true);
  });
});

describe('the models a person chose', () => {
  beforeEach(() => {
    for (const model of ownModels()) removeOwnModel(model.id);
  });

  it('adds, renames, and removes them, with a stable id', () => {
    const model = addOwnModel(OPENAI, 'gpt-x', { name: 'GPT X', contextTokens: 128000 });
    expect(model).toEqual({ id: ownModelId('openai', 'gpt-x'), provider: 'openai', apiModel: 'gpt-x', name: 'GPT X', agent: true, contextTokens: 128000 });
    expect(getOwnModel(model.id)).toEqual(model);
    expect(addOwnModel(OPENAI, 'gpt-x').name).toBe('GPT X');
    expect(ownModels()).toHaveLength(1);
    removeOwnModel(model.id);
    expect(ownModels()).toEqual([]);
  });

  it('lets Code mode start on for a known provider and off for a server of the user’s own, until they say', () => {
    expect(addOwnModel(ANTHROPIC, 'claude-x').agent).toBe(true);
    expect(addOwnModel(CUSTOM, 'llama3:8b').agent).toBe(false);
    expect(addOwnModel(CUSTOM, 'tools-model', { agent: true }).agent).toBe(true);
    expect(addOwnModel(OPENAI, 'no-tools', { agent: false }).agent).toBe(false);
    setOwnModelAgent(ownModelId(CUSTOM.id, 'llama3:8b'), true);
    expect(getOwnModel(ownModelId(CUSTOM.id, 'llama3:8b'))?.agent).toBe(true);
  });

  it('forgets all of a provider’s models together, and keeps them across a reload', async () => {
    addOwnModel(OPENAI, 'a');
    addOwnModel(OPENAI, 'b');
    addOwnModel(ANTHROPIC, 'c');
    removeProviderModels('openai');
    expect(ownModels().map(m => m.apiModel)).toEqual(['c']);
    vi.resetModules();
    const fresh = await import('../ownModels');
    expect(fresh.ownModels().map(m => m.apiModel)).toEqual(['c']);
  });

  it('ignores damaged entries in storage', async () => {
    localStorage.setItem('quo.ownModels', JSON.stringify([{ id: 'x' }, 7, null, { id: 'openai:ok', provider: 'openai', apiModel: 'ok', name: 'Ok', agent: 1 }, { id: 'wrong:id', provider: 'openai', apiModel: 'ok', name: 'Bad' }]));
    vi.resetModules();
    const fresh = await import('../ownModels');
    expect(fresh.ownModels()).toEqual([{ id: 'openai:ok', provider: 'openai', apiModel: 'ok', name: 'Ok', agent: true }]);
  });
});

describe('one step of Code mode on the user’s own key', () => {
  it('sends Quo’s rules and tools to the provider, and brings back the model’s calls without a charge', async () => {
    const sent: unknown[] = [];
    vi.doMock('../chat', () => ({
      chatWithProvider: async (_provider: unknown, request: unknown) => {
        sent.push(request);
        return { content: 'Looking.', reasoning: '', toolCalls: [{ id: 'c1', name: 'list_directory', arguments: '{}' }], finish: 'tool_calls', usage: { input: 10, output: 2 } };
      },
    }));
    const { askOwnAgentModel: ask } = await import('../../agent/own');
    const updates: string[] = [];
    const reply = await ask(OPENAI, { id: 'openai:m', provider: 'openai', apiModel: 'm', name: 'M', agent: true }, [{ role: 'user', content: 'Look around' }], {
      tools: ['list_directory', 'read_file', 'find_files', 'search_text'], project: '<b>My "App"</b>', platform: 'linux', instructions: { file: 'AGENTS.md', text: 'Use tabs.' }, signal: new AbortController().signal, onText: t => updates.push(t),
    });
    vi.doUnmock('../chat');
    expect(reply).toEqual({ content: 'Looking.', toolCalls: [{ id: 'c1', name: 'list_directory', arguments: '{}' }], finish: 'tool_calls', charged: 0, balance: null, usage: { input: 10, output: 2 } });
    const request = sent[0] as { model: string; maxTokens: number; messages: { role: string; content: string }[]; tools: { function: { name: string } }[] };
    expect(request.model).toBe('m');
    expect(request.messages[0].role).toBe('system');
    expect(request.messages[0].content).toMatch(/You are Quo Code/);
    expect(request.messages[0].content).toMatch(/<project-notes>\nUse tabs\./);
    expect(request.messages[0].content).not.toMatch(/<b>|"App"/);
    expect(request.messages[0].content).toMatch(/only read in this session \(plan mode\)/);
    expect(request.messages[1]).toEqual({ role: 'user', content: 'Look around' });
    expect(request.tools.map(t => t.function.name)).toEqual(['list_directory', 'read_file', 'find_files', 'search_text']);
    expect(askOwnAgentModel).toBeTypeOf('function');
  });
});
