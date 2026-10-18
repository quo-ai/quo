import { describe, expect, it } from 'vitest';
import type { CloudCatalog, CloudModel } from '../catalog';
import { everydayModels, frontierModels, messagesPerMonth, proExamples } from '../pro';

const model = (id: string, tier: CloudModel['tier'], creditsPerMessage: number, free = false): CloudModel => ({
  id, name: id.toUpperCase(), provider: 'P', description: 'd', free, tier, released: '2026-01-01', supportsThinking: true, creditsPerMessage,
});
const catalog = (models: CloudModel[]): CloudCatalog => ({ defaultModel: models[0].id, models });

const sample = catalog([
  model('luna', 'everyday', 0.08, true),
  model('fable', 'frontier', 8), model('opus', 'frontier', 3.2), model('sonnet', 'frontier', 1.6), model('grok', 'frontier', 1.2), model('mistral', 'frontier', 0.4),
  model('haiku', 'everyday', 0.08), model('flash', 'everyday', 1.3),
]);

describe('splitting the catalog', () => {
  it('finds the frontier models and the everyday paid ones, never the free one', () => {
    expect(frontierModels(sample).map(m => m.id)).toEqual(['fable', 'opus', 'sonnet', 'grok', 'mistral']);
    expect(everydayModels(sample).map(m => m.id)).toEqual(['haiku', 'flash']);
    expect(frontierModels(null)).toEqual([]);
    expect(everydayModels(null)).toEqual([]);
  });
});

describe('how far a month of credits goes', () => {
  it('rounds so it reads as an estimate', () => {
    expect(messagesPerMonth(8)).toBe(125);
    expect(messagesPerMonth(3.2)).toBe(315);
    expect(messagesPerMonth(1.6)).toBe(625);
    expect(messagesPerMonth(0.08)).toBe(12_500);
    expect(messagesPerMonth(0.03)).toBe(33_300);
    expect(messagesPerMonth(400)).toBe(3);
  });

  it('copes with nonsense, and never says zero for something you can afford at all', () => {
    expect(messagesPerMonth(0)).toBe(0);
    expect(messagesPerMonth(-1)).toBe(0);
    expect(messagesPerMonth(Number.NaN)).toBe(0);
    expect(messagesPerMonth(5000)).toBe(1);
    expect(messagesPerMonth(2, 100)).toBe(50);
  });
});

describe('the examples shown for Quo Pro', () => {
  it('span the range: the dearest frontier model, a middling one, and the cheapest paid one', () => {
    const examples = proExamples(sample);
    expect(examples.map(e => e.model.id)).toEqual(['fable', 'sonnet', 'haiku']);
    expect(examples.map(e => e.messages)).toEqual([125, 625, 12_500]);
  });

  it('never repeats a model, and copes with a small or empty catalog', () => {
    expect(proExamples(catalog([model('luna', 'everyday', 0.08, true), model('only', 'frontier', 2)])).map(e => e.model.id)).toEqual(['only']);
    expect(proExamples(catalog([model('luna', 'everyday', 0.08, true)]))).toEqual([]);
    expect(proExamples(null)).toEqual([]);
  });

  it('are chosen by cost, so they follow the catalog', () => {
    const changed = catalog([model('luna', 'everyday', 0.08, true), model('a', 'frontier', 20), model('b', 'frontier', 5), model('c', 'frontier', 1), model('z', 'everyday', 0.02)]);
    expect(proExamples(changed).map(e => e.model.id)).toEqual(['a', 'b', 'z']);
  });
});
