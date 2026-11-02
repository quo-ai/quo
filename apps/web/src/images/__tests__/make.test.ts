import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GeneratedImage, Message } from '../../chat/types';

vi.mock('../../ui/Toasts', () => ({ toast: () => {} }));
const createImage = vi.fn();
vi.mock('../api', () => ({ createImage: (...args: unknown[]) => createImage(...args) }));

const { makeImages } = await import('../make');
const { ApiError } = await import('../../cloud/api');

const creating = (id: string, extra: Partial<GeneratedImage> = {}): GeneratedImage => ({ id, prompt: `prompt ${id}`, aspect: '1:1', status: 'creating', ...extra });

afterEach(() => createImage.mockReset());

describe('making the images a reply asked for', () => {
  it('makes each, and a change to the last image sends that image with the prompt', async () => {
    createImage.mockResolvedValue({ image: 'data:image/png;base64,NEW', model: { id: 'm', name: 'FLUX 3 Klein' }, charged: 0, balance: null, freeRemaining: 2 });
    const messages: Message[] = [
      { id: 'a', role: 'assistant', content: '', images: [{ id: 'old', prompt: 'a fox', aspect: '1:1', status: 'done', dataUrl: 'data:image/png;base64,OLD' }] },
      { id: 'b', role: 'assistant', content: 'ok', images: [creating('x', { edit: true }), creating('y')] },
    ];
    const updates: GeneratedImage[][] = [];
    await makeImages(messages, 'b', images => updates.push(images), new AbortController().signal);
    expect(createImage.mock.calls[0][0]).toEqual({ prompt: 'prompt x', aspect: '1:1', edit: 'data:image/png;base64,OLD' });
    expect(createImage.mock.calls[1][0]).toEqual({ prompt: 'prompt y', aspect: '1:1' });
    expect(updates.at(-1)?.map(image => [image.status, image.model])).toEqual([['done', 'FLUX 3 Klein'], ['done', 'FLUX 3 Klein']]);
  });

  it('says why one failed, and Stop ends the rest', async () => {
    createImage.mockRejectedValueOnce(new ApiError(429, 'image_limit', 'You’ve made today’s 3 free images.'));
    const controller = new AbortController();
    const updates: GeneratedImage[][] = [];
    const messages: Message[] = [{ id: 'b', role: 'assistant', content: '', images: [creating('x'), creating('y')] }];
    await makeImages(messages, 'b', images => {
      updates.push(images);
      controller.abort();
    }, controller.signal);
    expect(updates.at(-1)?.map(image => [image.status, image.error])).toEqual([['failed', 'You’ve made today’s 3 free images.'], ['failed', 'Stopped.']]);
  });
});
