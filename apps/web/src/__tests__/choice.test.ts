import { describe, expect, it } from 'vitest';
import type { LocalModel } from '../catalog';
import type { CloudCatalog } from '../cloud/catalog';
import { choiceKey, resolveChoice } from '../models';
import type { ProviderAccount } from '../providers/accounts';
import type { OwnModel } from '../providers/ownModels';
import { PROVIDERS } from '../providers/registry';

const local = (id: string) => ({ id, name: id }) as LocalModel;
const catalog = { defaultModel: 'free', models: [{ id: 'free', name: 'Free' }] } as unknown as CloudCatalog;
const own: OwnModel[] = [{ id: 'openai:gpt-x', provider: 'openai', apiModel: 'gpt-x', name: 'GPT X', agent: true }, { id: 'custom-abc123:llama', provider: 'custom-abc123', apiModel: 'llama', name: 'Llama', agent: false }];
const account = (id: string, configured: boolean, custom = false): ProviderAccount => ({ info: custom ? { id, name: 'Mine', protocol: 'openai', baseUrl: 'http://localhost:1/v1', usage: false, custom: true } : PROVIDERS.find(p => p.id === id)!, configured, last4: null });

describe('which model a chat runs on', () => {
  const installed = [local('qwen')];

  it('uses the model of the user’s own key they picked, while its key is saved', () => {
    const choice = resolveChoice('own:openai:gpt-x', installed, catalog, own, [account('openai', true)]);
    expect(choice).toMatchObject({ kind: 'own', model: { id: 'openai:gpt-x' }, provider: { id: 'openai' } });
    expect(choiceKey(choice!)).toBe('own:openai:gpt-x');
  });

  it('goes back to the offline model when the key is gone, or the model was removed', () => {
    expect(resolveChoice('own:openai:gpt-x', installed, catalog, own, [account('openai', false)])).toMatchObject({ kind: 'local' });
    expect(resolveChoice('own:openai:missing', installed, catalog, own, [account('openai', true)])).toMatchObject({ kind: 'local' });
    expect(resolveChoice('own:openai:gpt-x', [], catalog, own, [account('openai', false)])).toBeNull();
  });

  it('lets a server of the user’s own work without a key', () => {
    expect(resolveChoice('own:custom-abc123:llama', [], catalog, own, [account('custom-abc123', false, true)])).toMatchObject({ kind: 'own', provider: { custom: true } });
  });

  it('still prefers what was picked among cloud and offline models', () => {
    expect(resolveChoice('cloud:free', installed, catalog, own, [])).toMatchObject({ kind: 'cloud' });
    expect(resolveChoice('local:qwen', installed, catalog, own, [])).toMatchObject({ kind: 'local' });
    expect(resolveChoice(null, installed, catalog, own, [])).toMatchObject({ kind: 'local', model: { id: 'qwen' } });
  });
});
