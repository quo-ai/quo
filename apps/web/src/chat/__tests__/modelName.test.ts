import { describe, expect, it } from 'vitest';
import { readableModel } from '../modelName';

describe('a model id as people say it', () => {
  it('reads Claude, GPT and Gemini ids, with or without a date or a provider in front', () => {
    expect(readableModel('claude-sonnet-5-5')).toBe('Claude Sonnet 5.5');
    expect(readableModel('claude-opus-4-1-20250805')).toBe('Claude Opus 4.1');
    expect(readableModel('claude-3-5-sonnet-20241022')).toBe('Claude 3.5 Sonnet');
    expect(readableModel('anthropic/claude-haiku-5-5')).toBe('Claude Haiku 5.5');
    expect(readableModel('gpt-6.1-sol')).toBe('GPT-6.1 Sol');
    expect(readableModel('openai/gpt-6-luna')).toBe('GPT-6 Luna');
    expect(readableModel('gemini-4-argon')).toBe('Gemini 4 Argon');
  });

  it('gives nothing for what it can’t read, so the chosen name is shown instead', () => {
    for (const id of [null, undefined, '', 'sonnet', 'llama3:8b', 'mistral-large-latest', 'qwen3.8-27b', 'claude']) expect(readableModel(id), String(id)).toBeNull();
  });
});
