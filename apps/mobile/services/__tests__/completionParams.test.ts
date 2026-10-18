import { resolveCompletionParams } from '../llm/completionParams';
import { getModelById } from '@/constants/models';
import { getSystemPrompt } from '@/constants/system-prompts';
import { getInitialContext } from '../llm/prompt';
import { AppSettings } from '@/types/chat';

const settings = (over: Partial<AppSettings> = {}) => ({ enableThinking: false, ...over }) as AppSettings;

describe('resolveCompletionParams', () => {
  it('uses the Qwen3.5 small-model card values and no repeat penalty', () => {
    const p = resolveCompletionParams(getModelById('qwen35-2b')!, settings({ temperature: 0.7 }));
    expect(p).toMatchObject({ temperature: 0.7, topP: 0.8, topK: 20, minP: 0, presencePenalty: 1.5, repeatPenalty: 1.0, isThinkingMode: false });
  });

  it('switches to the thinking profile when thinking is on', () => {
    const p = resolveCompletionParams(getModelById('qwen35-2b')!, settings({ enableThinking: true, temperature: 1.0 }));
    expect(p).toMatchObject({ isThinkingMode: true, topP: 0.95, topK: 20 });
  });

  it('treats reasoning checkpoints as always thinking', () => {
    expect(resolveCompletionParams(getModelById('ministral-3b-reasoning')!, settings()).isThinkingMode).toBe(true);
    expect(resolveCompletionParams(getModelById('nanbeige4-3b-thinking')!, settings()).isThinkingMode).toBe(true);
  });

  it('never applies a multiplicative repeat penalty by default', () => {
    for (const id of ['qwen35-0.8b', 'gemma3-4b', 'llama32-3b', 'phi4-mini', 'smollm3-3b']) {
      expect(resolveCompletionParams(getModelById(id)!, settings()).repeatPenalty).toBe(1.0);
    }
  });
});

describe('system prompts', () => {
  it('are short and only describe the text tool protocol to text-format models', () => {
    const native = getSystemPrompt('qwen35-2b');
    expect(native).not.toContain('[TOOL:');
    expect(native.split('\n').length).toBeLessThan(12);
    expect(getSystemPrompt('gemma3-4b')).toContain('[TOOL:save_memory');
    expect(getSystemPrompt('phi4-mini')).not.toMatch(/tool/i);
  });

  it('no longer hard-codes /no_think for SmolLM3', () => {
    expect(getSystemPrompt('smollm3-3b')).not.toContain('/no_think');
  });

  it('dates the prompt to the day, so the cached prefix survives a whole day', () => {
    const a = getInitialContext(new Date(2026, 9, 4, 9, 1));
    const b = getInitialContext(new Date(2026, 9, 4, 17, 59));
    expect(a).toBe(b);
    expect(a).toBe('Today is Sunday, October 4, 2026.');
  });
});
