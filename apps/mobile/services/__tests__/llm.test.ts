import { llmService } from '../llm';
import { Message } from '@/types/chat';

// No model is loaded in tests, so estimateTokens uses the ~4 chars/token
// heuristic — which makes context-fitting behavior deterministic.

function msg(role: 'user' | 'assistant', content: string, id = `${role}-${content.length}-${Math.random()}`): Message {
  return { id, role, content, timestamp: 1 };
}

describe('estimateTokens (heuristic fallback)', () => {
  it('estimates ~4 chars per token without a native context', async () => {
    expect(await llmService.estimateTokens('a'.repeat(40))).toBe(10);
    expect(await llmService.estimateTokens('abc')).toBe(1);
  });
});

describe('getDocumentTokenBudget', () => {
  it('reserves space for system prompt and output', () => {
    // Default model (Qwen3.5 0.8B) has an 8192 context.
    expect(llmService.getDocumentTokenBudget(0)).toBe(8192 - 1500);
  });

  it('guarantees at least 30% of context even with huge history', () => {
    expect(llmService.getDocumentTokenBudget(100000)).toBe(Math.floor(8192 * 0.3));
  });
});

describe('fitMessagesToContext', () => {
  const fit = (messages: Message[], requested: number) =>
    (llmService as any).fitMessagesToContext(messages, 'system prompt', requested) as Promise<{
      messages: Message[];
      maxTokens: number;
    }>;

  it('keeps everything when history is small', async () => {
    const messages = [msg('user', 'hi'), msg('assistant', 'hello'), msg('user', 'how are you?')];
    const result = await fit(messages, 512);
    expect(result.messages).toHaveLength(3);
    expect(result.maxTokens).toBe(512);
  });

  it('returns input untouched for empty history', async () => {
    const result = await fit([], 1024);
    expect(result.messages).toEqual([]);
    expect(result.maxTokens).toBe(1024);
  });

  it('drops oldest messages when history exceeds the budget, keeping the newest', async () => {
    // 40 alternating messages of ~500 tokens each — far beyond an 8K context.
    const messages: Message[] = [];
    for (let i = 0; i < 40; i++) {
      messages.push(msg(i % 2 === 0 ? 'user' : 'assistant', `${i}:` + 'x'.repeat(2000), `m${i}`));
    }
    const result = await fit(messages, 2048);

    expect(result.messages.length).toBeLessThan(40);
    expect(result.messages[result.messages.length - 1].id).toBe('m39');
    // Trimmed history must not start with an orphaned assistant reply
    expect(result.messages[0].role).toBe('user');
  });

  it('never returns a token budget below the floor', async () => {
    const messages = [msg('user', 'x'.repeat(40000))];
    const result = await fit(messages, 4096);
    expect(result.maxTokens).toBeGreaterThanOrEqual(16);
    expect(result.maxTokens).toBeLessThanOrEqual(4096);
  });
});

describe('compressConversationContext', () => {
  it('returns null when no model is loaded', async () => {
    const messages = Array.from({ length: 20 }, (_, i) =>
      msg(i % 2 === 0 ? 'user' : 'assistant', 'x'.repeat(2000), `m${i}`),
    );
    expect(await llmService.compressConversationContext(messages, null)).toBeNull();
  });
});

describe('fitMessagesToContext keeps a contiguous tail', () => {
  it('stops at the first message that does not fit instead of skipping it', async () => {
    const messages = [
      msg('user', 'u1 short', 'u1'),
      msg('assistant', 'x'.repeat(40000), 'a1-huge'),
      msg('user', 'u2', 'u2'),
      msg('assistant', 'a2', 'a2'),
      msg('user', 'u3', 'u3'),
    ];
    const result = await (llmService as any).fitMessagesToContext(messages, 'system prompt', 512);
    expect(result.messages.map((m: Message) => m.id)).toEqual(['u2', 'a2', 'u3']);
  });
});
