import { llmService } from '../llm';
import { Message } from '@/types/chat';

// compressConversationContext with a mocked native context. estimateTokens
// falls back to the ~4 chars/token heuristic because the mocked tokenize
// returns a non-array, which keeps threshold math deterministic.
const svc: any = llmService;

function msg(i: number, role: 'user' | 'assistant', content: string): Message {
  return { id: `m${i}`, role, content, timestamp: i };
}

function installMockContext(summaryText = 'Digest of earlier discussion.') {
  svc.context = {
    tokenize: jest.fn(async () => ({})),
    completion: jest.fn(async () => ({
      interrupted: false,
      text: summaryText,
      content: '',
      timings: {},
    })),
    release: jest.fn(async () => {}),
  };
  svc.isModelLoaded = true;
}

afterEach(() => {
  svc.context = null;
  svc.isModelLoaded = false;
  svc.isGeneratingResponse = false;
  svc.isSummarizing = false;
  svc.isCompleting = false;
});

describe('compressConversationContext', () => {
  it('returns null when no model is loaded', async () => {
    const messages = [msg(0, 'user', 'x'.repeat(3000))];
    expect(await llmService.compressConversationContext(messages, null)).toBeNull();
  });

  it('returns null when history is under the size threshold', async () => {
    installMockContext();
    const messages = Array.from({ length: 12 }, (_, i) =>
      msg(i, i % 2 ? 'assistant' : 'user', 'short message here'),
    );
    expect(await llmService.compressConversationContext(messages, null)).toBeNull();
    expect(svc.context.completion).not.toHaveBeenCalled();
  });

  it('returns null when too few messages exist beyond the live tail', async () => {
    installMockContext();
    const messages = Array.from({ length: 6 }, (_, i) => msg(i, 'user', 'x'.repeat(3000)));
    expect(await llmService.compressConversationContext(messages, null)).toBeNull();
    expect(svc.context.completion).not.toHaveBeenCalled();
  });

  it('folds old messages into a summary once the threshold is crossed', async () => {
    installMockContext();
    const messages = Array.from({ length: 20 }, (_, i) =>
      msg(i, i % 2 ? 'assistant' : 'user', `Message ${i}: ` + 'x'.repeat(1200)),
    );
    const result = await llmService.compressConversationContext(messages, null);
    expect(result).not.toBeNull();
    expect(result!.text).toBe('Digest of earlier discussion.');
    expect(result!.coversMessageCount).toBe(14); // 20 minus the live tail of 6
    expect(svc.context.completion).toHaveBeenCalledTimes(1);
  });

  it('rolls an existing summary forward, folding only new messages', async () => {
    installMockContext('Updated digest.');
    const messages = Array.from({ length: 30 }, (_, i) => msg(i, 'user', 'y'.repeat(1200)));
    const existing = { text: 'Old digest.', coversMessageCount: 14, updatedAt: 1 };

    const result = await llmService.compressConversationContext(messages, existing);
    expect(result).not.toBeNull();
    expect(result!.text).toBe('Updated digest.');
    expect(result!.coversMessageCount).toBe(24);

    const instruction = svc.context.completion.mock.calls[0][0].messages[1].content;
    expect(instruction).toContain('Old digest.');
  });

  it('refuses to run while a user generation owns the context', async () => {
    installMockContext();
    svc.isGeneratingResponse = true;
    const messages = Array.from({ length: 20 }, (_, i) => msg(i, 'user', 'z'.repeat(1200)));
    expect(await llmService.compressConversationContext(messages, null)).toBeNull();
    expect(svc.context.completion).not.toHaveBeenCalled();
  });

  it('returns null when the summarization is interrupted', async () => {
    installMockContext();
    svc.context.completion = jest.fn(async () => ({ interrupted: true, text: '', content: '', timings: {} }));
    const messages = Array.from({ length: 20 }, (_, i) => msg(i, 'user', 'w'.repeat(1200)));
    expect(await llmService.compressConversationContext(messages, null)).toBeNull();
  });
});
