import { describe, expect, it } from 'vitest';
import type { CloudCatalog, CloudModel } from '../catalog';
import { groupModels } from '../groups';

const model = (id: string, tier: CloudModel['tier'], free = false): CloudModel => ({
  id, name: id, provider: 'P', description: 'd', free, tier, released: '2026-01-01', supportsThinking: true, creditsPerMessage: 1,
});

describe('grouping the cloud models', () => {
  const catalog: CloudCatalog = {
    defaultModel: 'luna',
    models: [model('luna', 'everyday', true), model('fable', 'frontier'), model('haiku', 'everyday'), model('opus', 'frontier'), model('flash', 'everyday')],
  };

  it('splits them into free, frontier and everyday, each in catalog order, with none in two groups', () => {
    const groups = groupModels(catalog);
    expect(groups.free.map(m => m.id)).toEqual(['luna']);
    expect(groups.frontier.map(m => m.id)).toEqual(['fable', 'opus']);
    expect(groups.everyday.map(m => m.id)).toEqual(['haiku', 'flash']);
    expect(groups.free.length + groups.frontier.length + groups.everyday.length).toBe(catalog.models.length);
  });

  it('gives empty groups when there is no catalog (offline, or cloud models switched off)', () => {
    expect(groupModels(null)).toEqual({ free: [], frontier: [], everyday: [] });
  });
});
