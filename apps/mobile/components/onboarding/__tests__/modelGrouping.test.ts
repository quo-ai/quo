import { getModelFamilies } from '../modelGrouping';
import { AVAILABLE_MODELS, ModelConfig } from '@/constants/models';

describe('getModelFamilies', () => {
  it('puts every catalog model in exactly one family', () => {
    const families = getModelFamilies();
    const ids = families.flatMap(f => f.models.map(m => m.id));
    expect(ids.sort()).toEqual(AVAILABLE_MODELS.map(m => m.id).sort());
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('includes the Gemma, Phi and Llama families', () => {
    const byId = Object.fromEntries(getModelFamilies().map(f => [f.id, f.models.map(m => m.id)]));
    expect(byId.gemma).toEqual(expect.arrayContaining(['gemma3-1b', 'gemma3-4b']));
    expect(byId.phi).toEqual(['phi4-mini']);
    expect(byId.llama).toEqual(['llama32-3b']);
  });

  it('collects unknown models into a fallback family', () => {
    const stray = { ...AVAILABLE_MODELS[0], id: 'brand-new-1b' } as ModelConfig;
    const families = getModelFamilies([...AVAILABLE_MODELS, stray]);
    expect(families.find(f => f.id === 'other')?.models.map(m => m.id)).toEqual(['brand-new-1b']);
    expect(families[families.length - 1].id).toBe('custom');
  });
});
