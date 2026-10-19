// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { cloudModels, isFreeModel, publicCatalog } from '../cloudModels.js';

describe('the cloud model catalog', () => {
  const models = cloudModels();

  it('lists each model once, under an OpenRouter-style id', () => {
    const ids = models.map(model => model.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+\/[a-z0-9.:-]+$/);
  });

  it('has exactly one free model: the default, which is an everyday one', () => {
    const free = models.filter(isFreeModel);
    expect(free).toHaveLength(1);
    expect(free[0].tier).toBe('everyday');
  });

  it('puts the frontier models behind the paywall, and has plenty of them', () => {
    const frontier = models.filter(model => model.tier === 'frontier');
    expect(frontier.length).toBeGreaterThanOrEqual(10);
    expect(frontier.some(isFreeModel)).toBe(false);
    for (const model of models) expect(['frontier', 'everyday']).toContain(model.tier);
  });

  it('describes every model, with a real price, release date and output limit', () => {
    for (const model of models) {
      expect(model.name.length, model.id).toBeGreaterThan(2);
      expect(model.provider.length, model.id).toBeGreaterThan(1);
      expect(model.description.length, model.id).toBeGreaterThan(10);
      expect(model.usdIn, model.id).toBeGreaterThan(0);
      expect(model.usdOut, model.id).toBeGreaterThanOrEqual(model.usdIn);
      expect(model.maxOutput, model.id).toBeGreaterThanOrEqual(4096);
      expect(model.released, model.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(Date.parse(model.released)), model.id).toBe(false);
    }
  });

  it('is published with its tier and release date, but never its prices', () => {
    const published = publicCatalog();
    expect(published.defaultModel).toBe(models.find(isFreeModel)!.id);
    expect(published.models).toHaveLength(models.length);
    for (const model of published.models) {
      expect(Object.keys(model).sort()).toEqual(['agent', 'agentLight', 'creditsPerMessage', 'description', 'free', 'id', 'name', 'provider', 'released', 'supportsThinking', 'thinking', 'tier']);
      expect(model.creditsPerMessage).toBeGreaterThan(0);
    }
  });

  it('shows what a typical message costs, with the most capable models costing the most', () => {
    const cost = (id: string) => publicCatalog().models.find(model => model.id === id)!.creditsPerMessage;
    expect(cost('anthropic/claude-fable-5.1')).toBeGreaterThan(cost('anthropic/claude-sonnet-5.5'));
    expect(cost('anthropic/claude-sonnet-5.5')).toBeGreaterThan(cost('anthropic/claude-haiku-5.5'));
  });
});

describe('the prices behind the estimates', () => {
  // These reserve credits before a reply and tell people what a message costs, so they must not undershoot.
  // Models served by many hosts are priced at about the median host: OpenRouter's own listing shows the cheapest.
  it('are not set at the cheapest host for the open models many hosts serve', () => {
    const price = (id: string) => cloudModels().find(model => model.id === id)!;
    expect(price('moonshotai/kimi-k3').usdIn).toBeGreaterThanOrEqual(2.5);
    expect(price('moonshotai/kimi-k3').usdOut).toBeGreaterThanOrEqual(14);
    expect(price('deepseek/deepseek-v4-pro-0813').usdOut).toBeGreaterThanOrEqual(3);
    expect(price('deepseek/deepseek-v4.1-flash').usdOut).toBeGreaterThanOrEqual(0.78);
    expect(price('qwen/qwen3.8-27b').usdOut).toBeGreaterThanOrEqual(2.33);
  });
});
