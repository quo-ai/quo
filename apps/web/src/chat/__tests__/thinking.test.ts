import { describe, expect, it } from 'vitest';
import { defaultLevel, levelsFor, reasoningParam, type ThinkingSpec } from '../../../shared/thinking';
import { defaultThinking, nextLevel, thinkingLevels, wireThinking } from '../thinking';

// Real shapes, from OpenRouter's description of these models (19 Oct 2026).
const CLAUDE: ThinkingSpec = { mandatory: true, efforts: ['low', 'medium', 'high', 'xhigh', 'max'], off: false, defaultOn: true, default: 'high' };
const LUNA: ThinkingSpec = { mandatory: false, efforts: ['low', 'medium', 'high', 'xhigh', 'max'], off: 'effort', defaultOn: true, default: 'medium' };
const DEEPSEEK: ThinkingSpec = { mandatory: false, efforts: ['low', 'high', 'max'], off: 'effort', defaultOn: true, default: 'high' };
const MISTRAL: ThinkingSpec = { mandatory: false, efforts: ['high'], off: 'effort', defaultOn: true, default: 'high' };
const GEMMA: ThinkingSpec = { mandatory: false, efforts: [], off: 'enabled', defaultOn: false };
const GEMINI: ThinkingSpec = { mandatory: true, efforts: ['low', 'medium', 'high'], off: false, defaultOn: true, default: 'medium' };

describe('which thinking levels a model really has', () => {
  it('has no Off for a model that always thinks, and offers quick and deep around its own default', () => {
    expect(levelsFor(GEMINI)).toEqual(['quick', 'auto', 'deep']);
    expect(levelsFor(CLAUDE)).toEqual(['quick', 'auto']); // its own default already is "high": a Deep would be the same as Auto
  });

  it('has Off for a model that can be switched off', () => {
    expect(levelsFor(LUNA)).toEqual(['off', 'quick', 'auto', 'deep']);
  });

  it('leaves out a level that would be the same as Auto', () => {
    expect(levelsFor(DEEPSEEK)).toEqual(['off', 'quick', 'auto']); // its default already is "high"
    expect(levelsFor(MISTRAL)).toEqual(['off', 'auto']); // only "high", or nothing
  });

  it('is plain on and off for a model with no efforts, starting off', () => {
    expect(levelsFor(GEMMA)).toEqual(['off', 'deep']);
    expect(defaultLevel(GEMMA)).toBe('off');
    expect(defaultLevel(CLAUDE)).toBe('auto');
  });

  it('shows nothing when there is no real choice, or no thinking at all', () => {
    expect(levelsFor(null)).toEqual([]);
    expect(levelsFor({ mandatory: true, efforts: ['high'], off: false, defaultOn: true, default: 'high' })).toEqual([]);
  });

  it('holds the free model to a low effort: no deep, and Auto lands on low', () => {
    expect(levelsFor(LUNA, 'low')).toEqual(['off', 'auto']);
    expect(reasoningParam(LUNA, 'auto', 'low')).toEqual({ effort: 'low' });
    expect(reasoningParam(LUNA, 'deep', 'low')).toEqual({ effort: 'low' });
  });
});

describe('what is sent for each level', () => {
  it('sends nothing for Auto, so the model decides for itself', () => {
    for (const spec of [CLAUDE, LUNA, DEEPSEEK, MISTRAL, GEMINI]) expect(reasoningParam(spec, 'auto')).toBeUndefined();
    expect(reasoningParam(null, 'deep')).toBeUndefined();
  });

  it('only ever sends an effort the model accepts (DeepSeek has no medium, Mistral only high)', () => {
    expect(reasoningParam(DEEPSEEK, 'quick')).toEqual({ effort: 'low' });
    expect(reasoningParam(DEEPSEEK, 'deep')).toEqual({ effort: 'high' });
    expect(reasoningParam(MISTRAL, 'quick')).toBeUndefined();
    expect(reasoningParam(MISTRAL, 'deep')).toEqual({ effort: 'high' });
    expect(reasoningParam(CLAUDE, 'quick')).toEqual({ effort: 'low' });
    expect(reasoningParam(GEMINI, 'deep')).toEqual({ effort: 'high' });
  });

  it('turns thinking off the way the model allows, and never for one that always thinks', () => {
    expect(reasoningParam(LUNA, 'off')).toEqual({ effort: 'none' });
    expect(reasoningParam(GEMMA, 'off')).toEqual({ enabled: false });
    expect(reasoningParam(CLAUDE, 'off')).toBeUndefined();
    expect(reasoningParam(GEMINI, 'off')).toBeUndefined();
  });

  it('turns thinking on for a model that is off unless asked', () => {
    expect(reasoningParam(GEMMA, 'deep')).toEqual({ enabled: true });
    expect(reasoningParam(GEMMA, 'auto')).toBeUndefined();
  });
});

describe('the choices in the app', () => {
  const cloud = (extra: Record<string, unknown>) => ({ kind: 'cloud', model: { supportsThinking: true, ...extra } }) as never;
  const local = (supportsThinking: boolean) => ({ kind: 'local', model: { supportsThinking } }) as never;

  it('uses the levels the server lists, and starts on Auto where there is one', () => {
    expect(thinkingLevels(cloud({ thinking: ['quick', 'auto', 'deep'] }))).toEqual(['quick', 'auto', 'deep']);
    expect(defaultThinking(cloud({ thinking: ['quick', 'auto', 'deep'] }))).toBe('auto');
    expect(defaultThinking(cloud({ thinking: ['off', 'deep'] }))).toBe('off');
  });

  it('offers an offline model on or off, starting off, and a model with an own key nothing', () => {
    expect(thinkingLevels(local(true))).toEqual(['off', 'deep']);
    expect(defaultThinking(local(true))).toBe('off');
    expect(thinkingLevels(local(false))).toEqual([]);
    expect(thinkingLevels({ kind: 'own', model: {}, provider: {} } as never)).toEqual([]);
    expect(thinkingLevels(null)).toEqual([]);
  });

  it('copes with a server that only knew yes or no, and never sends it a word it would read as yes', () => {
    const old = cloud({});
    expect(thinkingLevels(old)).toEqual(['off', 'auto']);
    expect(defaultThinking(old)).toBe('off');
    expect(wireThinking(old, 'off')).toBe(false);
    expect(wireThinking(old, 'auto')).toBe(true);
    expect(wireThinking(cloud({ thinking: ['off', 'auto'] }), 'off')).toBe('off');
  });

  it('steps through the levels for /think', () => {
    expect(nextLevel(['off', 'auto', 'deep'], 'off')).toBe('auto');
    expect(nextLevel(['off', 'auto', 'deep'], 'deep')).toBe('off');
    expect(nextLevel(['quick', 'auto'], 'off')).toBe('quick');
  });
});
