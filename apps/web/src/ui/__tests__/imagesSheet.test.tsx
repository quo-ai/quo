import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Conversation } from '../../chat/types';
import { ImagesSheet, imagesIn } from '../ImagesSheet';

const done = (id: string, where?: 'device' | 'cloud') => ({ id, prompt: `prompt ${id}`, aspect: '1:1' as const, status: 'done' as const, dataUrl: `data:image/png;base64,${id}`, model: 'Z-Image Turbo', ...(where ? { where } : {}) });
const chat = (id: string, updatedAt: number, images: object[][]): Conversation => ({
  id, title: `Chat ${id}`, createdAt: 0, updatedAt,
  messages: images.map((list, i) => ({ id: `${id}-m${i}`, role: 'assistant', content: '', images: list })) as Conversation['messages'],
});

describe('the images tab', () => {
  it('lists every made image, newest chat first and the last made first, leaving out ones still being made or failed', () => {
    const list = imagesIn([
      chat('old', 1, [[done('a')], [done('b'), { id: 'c', prompt: 'x', aspect: '1:1', status: 'creating' }]]),
      chat('new', 2, [[done('d', 'device'), { id: 'e', prompt: 'x', aspect: '1:1', status: 'failed' }]]),
    ]);
    expect(list.map(item => [item.chat.id, item.image.id])).toEqual([['new', 'd'], ['old', 'b'], ['old', 'a']]);
  });

  it('says where each was made, and how to make one when there are none', () => {
    const html = renderToStaticMarkup(createElement(ImagesSheet, { conversations: [chat('x', 1, [[done('a', 'device'), done('b', 'cloud')]])], onOpenChat: () => {}, onClose: () => {} }));
    expect(html).toContain('On this computer');
    expect(html).toContain('In the cloud');
    expect(html).toContain('download="quo-image-1.png"');
    const empty = renderToStaticMarkup(createElement(ImagesSheet, { conversations: [], onOpenChat: () => {}, onClose: () => {} }));
    expect(empty).toContain('No images yet.');
    expect(empty).toContain('/image');
  });
});
