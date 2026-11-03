// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GeneratedImage, Message } from '../../chat/types';

const state = vi.hoisted(() => ({ installed: new Set<string>(), cloudCalls: 0 }));
vi.mock('../../storage/downloads', () => ({ downloadState: (id: string) => (state.installed.has(id) ? { status: 'installed' } : undefined) }));
vi.mock('../api', () => ({ createImage: async () => { state.cloudCalls++; return { image: 'data:image/png;base64,cloud', model: { id: 'flux', name: 'FLUX' }, charged: 0, balance: null, freeRemaining: 3 }; } }));
vi.mock('../../cloud/account', () => ({ applyUsage: () => {} }));
vi.mock('../../ui/Toasts', () => ({ toast: () => {} }));

const { DEVICE_IMAGE_MODELS } = await import('../deviceModels');
const { deviceImageModel, makeOnDevice } = await import('../device');
const { makeImages, ASK_FOR_CLOUD } = await import('../make');
const { setImagePrefs } = await import('../prefs');
const model = DEVICE_IMAGE_MODELS[0];

let sent: unknown[] = [];
let cancelled = 0;
let progress: ((event: { type: 'progress'; step: number; steps: number }) => void) | null = null;
beforeEach(() => {
  sent = [];
  cancelled = 0;
  state.installed.clear();
  state.cloudCalls = 0;
  vi.stubGlobal('window', {
    quoDesktop: {
      images: {
        make: async (request: unknown) => {
          sent.push(request);
          progress?.({ type: 'progress', step: 8, steps: 8 });
          return { ok: { image: 'data:image/png;base64,device', seed: 1 } };
        },
        cancel: async () => { cancelled++; return { ok: null }; },
        onEvent: (callback: typeof progress) => { progress = callback; return () => { progress = null; }; },
      },
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('image models on this computer', () => {
  it('are three files with the names the desktop app looks for, exact sizes, from Hugging Face, with an open licence', () => {
    for (const one of DEVICE_IMAGE_MODELS) {
      expect(one.files.map(file => file.name)).toEqual(['diffusion.gguf', 'text.gguf', 'vae.safetensors']);
      for (const file of one.files) {
        expect(file.url.startsWith('https://huggingface.co/')).toBe(true);
        expect(Number.isSafeInteger(file.sizeBytes) && file.sizeBytes > 0).toBe(true);
      }
      expect(one.licence).toMatch(/Apache|MIT/);
    }
  });

  it('suggests the most detailed model that fits the graphics memory, and uses the one chosen when several are downloaded', async () => {
    const { suggestedImageModel } = await import('../deviceModels');
    expect(suggestedImageModel(8).id).toBe('image-z-image-turbo');
    expect(suggestedImageModel(6).id).toBe('image-flux2-klein-4b');
    expect(suggestedImageModel(null).id).toBe('image-z-image-turbo');
    state.installed.add('image-z-image-turbo');
    state.installed.add('image-flux2-klein-4b');
    expect(deviceImageModel()?.id).toBe('image-z-image-turbo');
    setImagePrefs({ model: 'image-flux2-klein-4b' });
    expect(deviceImageModel()?.id).toBe('image-flux2-klein-4b');
    setImagePrefs({ model: 'gone' });
    expect(deviceImageModel()?.id).toBe('image-z-image-turbo');
    setImagePrefs({ model: null });
  });

  it('sends a picture to change only to a model that changes pictures, and the chosen size', async () => {
    state.installed.add('image-flux2-klein-4b');
    setImagePrefs({ model: 'image-flux2-klein-4b', size: 'quick' });
    await makeOnDevice({ prompt: 'at night', aspect: '1:1', reference: 'data:image/png;base64,AAAA' }, new AbortController().signal);
    expect(sent.at(-1)).toMatchObject({ modelId: 'image-flux2-klein-4b', reference: 'data:image/png;base64,AAAA', size: 'quick', steps: 4 });
    setImagePrefs({ model: 'image-z-image-turbo', size: 'standard' });
    state.installed.add('image-z-image-turbo');
    await makeOnDevice({ prompt: 'at night', aspect: '1:1', reference: 'data:image/png;base64,AAAA' }, new AbortController().signal);
    expect(sent.at(-1)).not.toHaveProperty('reference');
    setImagePrefs({ model: null });
  });

  it('is used only once downloaded, in the desktop app', () => {
    expect(deviceImageModel()).toBeNull();
    state.installed.add(model.id);
    expect(deviceImageModel()?.id).toBe(model.id);
    vi.stubGlobal('window', {});
    expect(deviceImageModel()).toBeNull();
  });

  it('sends only the model’s id, the prompt, the shape and the model’s own settings, and reports progress', async () => {
    state.installed.add(model.id);
    const steps: number[] = [];
    const made = await makeOnDevice({ prompt: 'a lighthouse', aspect: '16:9' }, new AbortController().signal, step => steps.push(step));
    expect(made).toEqual({ image: 'data:image/png;base64,device', model: model.name, setAside: false });
    expect(sent).toEqual([{ modelId: model.id, prompt: 'a lighthouse', aspect: '16:9', steps: model.steps, cfg: model.cfg, size: 'standard' }]);
    expect(steps).toEqual([8]);
    expect(progress).toBeNull(); // stopped listening
  });

  it('stops the image when the chat is stopped', async () => {
    state.installed.add(model.id);
    const controller = new AbortController();
    const making = makeOnDevice({ prompt: 'a cat', aspect: '1:1' }, controller.signal);
    controller.abort();
    await making;
    expect(cancelled).toBe(1);
  });
});

describe('a reply’s images', () => {
  const reply = (images: Partial<GeneratedImage>[]): Message[] => [{ id: 'r', role: 'assistant', content: '', images: images.map((image, i) => ({ id: `i${i}`, prompt: 'a cat', aspect: '1:1', status: 'creating', ...image })) } as Message];

  it('in an offline chat with an image model are made here, never in the cloud, a change too', async () => {
    state.installed.add(model.id);
    let images: GeneratedImage[] = [];
    await makeImages(reply([{}, { edit: true }]), 'r', next => { images = next; }, new AbortController().signal, { chat: 'local' });
    expect(state.cloudCalls).toBe(0);
    expect(images.map(image => [image.status, image.where, image.charged, image.model])).toEqual([['done', 'device', 0, model.name], ['done', 'device', 0, model.name]]);
    expect(images.every(image => image.progress === undefined)).toBe(true); // progress is only while it's made
  });

  it('go to the cloud in a cloud chat; an offline chat without an image model asks first, unless told not to', async () => {
    state.installed.add(model.id);
    let images: GeneratedImage[] = [];
    await makeImages(reply([{}]), 'r', next => { images = next; }, new AbortController().signal, { chat: 'cloud' });
    expect(images[0].where).toBe('cloud');
    state.installed.clear();
    await makeImages(reply([{}]), 'r', next => { images = next; }, new AbortController().signal, { chat: 'local' });
    expect(images[0]).toMatchObject({ status: 'failed', choose: true, error: ASK_FOR_CLOUD });
    expect(state.cloudCalls).toBe(1); // nothing was sent for the offline chat
    setImagePrefs({ offlineCloud: 'allow' });
    await makeImages(reply([{}]), 'r', next => { images = next; }, new AbortController().signal, { chat: 'local' });
    expect(images[0].where).toBe('cloud');
    setImagePrefs({ offlineCloud: 'ask' });
    expect(sent).toEqual([]);
  });

  it('follow a choice made on the image, and "every image on this computer"', async () => {
    state.installed.add(model.id);
    let images: GeneratedImage[] = [];
    await makeImages(reply([{ want: 'cloud' }]), 'r', next => { images = next; }, new AbortController().signal, { chat: 'local' });
    expect(images[0].where).toBe('cloud');
    setImagePrefs({ everyOnDevice: true });
    await makeImages(reply([{}]), 'r', next => { images = next; }, new AbortController().signal, { chat: 'cloud' });
    setImagePrefs({ everyOnDevice: false });
    expect(images[0].where).toBe('device');
  });
});
