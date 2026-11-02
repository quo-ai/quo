import { describe, expect, it } from 'vitest';
import { chatPrompt, IMAGE_WRITER_PROMPT, webSystemPrompt } from '../../../shared/prompts';
import { buildContext } from '../../chat/context';
import type { Message } from '../../chat/types';
import { showingImages } from '../reply';
import { asImageAsk, imageAsks, modelText, withoutImageAsks } from '../tags';

describe('image lines in a reply', () => {
  it('reads each image a reply asks for: its prompt, shape, and whether it changes the last one', () => {
    const reply = 'Here you go.\n<image aspect="16:9">A fox in the snow at dawn</image>\n<image edit="last" aspect="square">Make it night</image>\n<image>A third one</image>';
    expect(imageAsks(reply)).toEqual([
      { prompt: 'A fox in the snow at dawn', aspect: '16:9', edit: false },
      { prompt: 'Make it night', aspect: '1:1', edit: true },
    ]);
    expect(imageAsks('<image aspect="4:3">   </image>')).toEqual([]);
  });

  it('shows the reply without the lines, nor the start of one still arriving', () => {
    expect(withoutImageAsks('Here you go.\n\n<image aspect="1:1">A fox</image>\n\nEnjoy.')).toBe('Here you go.\n\nEnjoy.');
    expect(withoutImageAsks('Here you go.\n<image aspect="1:1">A fox in')).toBe('Here you go.');
    expect(withoutImageAsks('Here you go.\n<ima')).toBe('Here you go.');
    expect(withoutImageAsks('Use <img> tags in HTML.')).toBe('Use <img> tags in HTML.');
  });

  it('turns /image into a request for an image', () => {
    expect(asImageAsk('/image a fox in the snow')).toBe('Make an image: a fox in the snow');
    expect(asImageAsk('/draw a cat')).toBe('Make an image: a cat');
    expect(asImageAsk('/image')).toBeNull();
    expect(asImageAsk('an image of a fox')).toBeNull();
  });

  it('takes the lines out of every update, and adds the images to make once the reply is final', () => {
    const patches: Partial<Message>[] = [];
    const update = showingImages(patch => patches.push(patch));
    update({ content: 'Sure.\n<image aspect="3:2">A red barn' }, false);
    update({ content: 'Sure.\n<image aspect="3:2">A red barn</image>' }, true);
    expect(patches[0]).toEqual({ content: 'Sure.' });
    expect(patches[1].content).toBe('Sure.');
    expect(patches[1].images).toMatchObject([{ prompt: 'A red barn', aspect: '3:2', status: 'creating' }]);
    update({ images: [] }, true);
    expect(patches[2]).toEqual({ images: [] });
  });

  it('tells the model later what images it made, so it can change the last one', () => {
    const reply: Message = { id: 'r', role: 'assistant', content: 'Here it is.', images: [{ id: 'i', prompt: 'A fox at dawn', aspect: '1:1', status: 'done', dataUrl: 'data:image/png;base64,AA' }, { id: 'j', prompt: 'Failed one', aspect: '1:1', status: 'failed' }] };
    expect(modelText(reply)).toBe('Here it is.\n[Image made: A fox at dawn]');
    const turns = buildContext('System', [{ id: 'u', role: 'user', content: 'Draw a fox' }, { ...reply, content: '' }, { id: 'u2', role: 'user', content: 'Make it night' }], 100_000, 1000);
    expect(turns[2]).toEqual({ role: 'assistant', content: '[Image made: A fox at dawn]' });
  });
});

describe('image rules in the prompts', () => {
  it('models in the cloud and with the person’s own key are told how to ask; offline models are not', () => {
    expect(chatPrompt('cloud')).toMatch(/You can make images/);
    expect(webSystemPrompt('cloud', 'today')).toMatch(/You can make images/);
    expect(chatPrompt('local')).not.toMatch(/image/i);
    expect(webSystemPrompt('local', 'today')).not.toMatch(/make images/);
    expect(IMAGE_WRITER_PROMPT).toMatch(/reply with this line only/);
  });
});
