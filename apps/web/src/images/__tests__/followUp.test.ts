// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chatPrompt, IMAGE_FOLLOW_UP_PROMPT } from '../../../shared/prompts';
import type { LocalModel } from '../../catalog';
import type { Message } from '../../chat/types';
import type { ModelChoice } from '../../models';

// The offline model's side call: what it answers, and what it was asked.
const engine = vi.hoisted(() => ({ answer: '', stopped: false, asked: [] as { role: string; content: string }[][], modelId: 'qwen35-9b' as string | null }));
vi.mock('../../engine/localEngine', () => ({
  localEngine: {
    get modelId() { return engine.modelId; },
    generate: async (_model: unknown, turns: { role: string; content: string }[]) => {
      engine.asked.push(turns);
      return { content: engine.answer, reasoning: '', tokens: 1, tokensPerSecond: 1, timeToFirstTokenMs: 1, stopped: engine.stopped };
    },
  },
}));

const { replyWithImageFollowUp } = await import('../reply');

const local: ModelChoice = { kind: 'local', model: { id: 'qwen35-9b', name: 'Qwen3.5 9B' } as LocalModel };
const madeApple: Message = { id: 'a', role: 'assistant', content: '', images: [{ id: 'i', prompt: 'A red apple on a tree branch', aspect: '4:3', status: 'done', dataUrl: 'data:image/png;base64,AAAA' }] };
const asked = (text: string): Message => ({ id: 'u', role: 'user', content: text });

function follow(earlier: Message[], choice: ModelChoice = local) {
  const updates: Partial<Message>[] = [];
  const statuses: string[] = [];
  const result = replyWithImageFollowUp(choice, earlier.at(-1)!.content, earlier, patch => updates.push(patch), status => statuses.push(status));
  return { result, updates, statuses };
}

beforeEach(() => {
  engine.answer = '';
  engine.stopped = false;
  engine.asked = [];
  engine.modelId = 'qwen35-9b';
});

describe('the message right after an image, in an offline chat', () => {
  it('becomes a change to that image when the model says it asks for one', async () => {
    engine.answer = '<image aspect="4:3" edit="last">The same tree branch with leaves, and no apple</image>';
    const { result, updates } = follow([asked('Make an image: an apple on a tree'), madeApple, asked('Can you remove the apple from the image?')]);
    expect(await result).toBe(true);
    expect(updates).toEqual([{ content: '', images: [expect.objectContaining({ prompt: 'The same tree branch with leaves, and no apple', aspect: '4:3', edit: true, status: 'creating' })] }]);
    // The model is given the last image's prompt and the request, under the rules for this one decision.
    expect(engine.asked[0][0].content).toBe(IMAGE_FOLLOW_UP_PROMPT);
    expect(engine.asked[0][1].content).toMatch(/A red apple on a tree branch[\s\S]*remove the apple/);
  });

  it('is answered as usual when it is about something else', async () => {
    engine.answer = 'CHAT';
    const { result, updates } = follow([madeApple, asked('What kind of apple is that?')]);
    expect(await result).toBe(false);
    expect(updates).toEqual([]);
  });

  it('asks nothing extra in other chats: no image just before, a cloud model, or an image that failed', async () => {
    expect(await follow([asked('hi'), { id: 'r', role: 'assistant', content: 'Hello!' }, asked('remove the apple')]).result).toBe(false);
    expect(await follow([madeApple, asked('remove the apple')], { kind: 'cloud', model: { id: 'x' } } as ModelChoice).result).toBe(false);
    const failed: Message = { ...madeApple, images: [{ ...madeApple.images![0], status: 'failed', dataUrl: undefined }] };
    expect(await follow([failed, asked('remove the apple')]).result).toBe(false);
    expect(engine.asked).toEqual([]);
  });

  it('shows the model loading when it was set aside for the image, and ends when stopped', async () => {
    engine.modelId = null;
    engine.stopped = true;
    const { result, updates, statuses } = follow([madeApple, asked('remove the apple')]);
    expect(await result).toBe(true);
    expect(statuses[0]).toBe('loading');
    expect(updates).toEqual([{ content: '', stopped: true }]);
  });
});

describe('the rules for that decision', () => {
  it('are a side call of their own: the offline chat prompt still has no image rules', () => {
    expect(IMAGE_FOLLOW_UP_PROMPT).toMatch(/reply with this line only/);
    expect(IMAGE_FOLLOW_UP_PROMPT).toMatch(/reply with the word CHAT only/);
    expect(chatPrompt('local')).not.toMatch(/image/i);
  });
});
