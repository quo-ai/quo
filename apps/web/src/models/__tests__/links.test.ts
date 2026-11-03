// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { modelInfo } from '../huggingface';
import { clearModelLink, listenForModelLinks, toModelLink } from '../links';

afterEach(() => {
  vi.unstubAllGlobals();
  clearModelLink();
});

describe('a link from Hugging Face', () => {
  it('is checked again in the page: a repository id, and at most a .gguf inside it', () => {
    expect(toModelLink({ repo: 'unsloth/gemma-4-E2B-it-GGUF' })).toEqual({ repo: 'unsloth/gemma-4-E2B-it-GGUF' });
    expect(toModelLink({ repo: 'a/b', file: 'sub/m-Q4_K_M.gguf' })).toEqual({ repo: 'a/b', file: 'sub/m-Q4_K_M.gguf' });
    for (const value of [null, 'a/b', { repo: '../b' }, { repo: 'a' }, { repo: 'a/b/c' }, { repo: 'a/b', file: '../x.gguf' }, { repo: 'a/b', file: '/x.gguf' }, { repo: 'a/b', file: 'x.exe' }, { repo: 'a/b', file: 3 }, { repo: `${'a'.repeat(200)}/b` }]) {
      expect(toModelLink(value)).toBeNull();
    }
  });

  it('reads the repository’s details from Hugging Face, and refuses one that isn’t there or is another', async () => {
    const answers: Record<string, Response> = {
      'https://huggingface.co/api/models/unsloth/m-GGUF?expand%5B%5D=gguf&expand%5B%5D=downloads&expand%5B%5D=likes': Response.json({ id: 'unsloth/m-GGUF', downloads: 5, likes: 1, gguf: { architecture: 'gemma4', context_length: 131072, total: 4e9 } }),
      'https://huggingface.co/api/models/a/gone?expand%5B%5D=gguf&expand%5B%5D=downloads&expand%5B%5D=likes': new Response('', { status: 404 }),
      'https://huggingface.co/api/models/a/other?expand%5B%5D=gguf&expand%5B%5D=downloads&expand%5B%5D=likes': Response.json({ id: 'b/elsewhere' }),
    };
    vi.stubGlobal('fetch', async (url: string) => answers[url] ?? new Response('', { status: 500 }));
    expect(await modelInfo('unsloth/m-GGUF')).toMatchObject({ repo: 'unsloth/m-GGUF', architecture: 'gemma4', support: 'yes', contextLength: 131072 });
    await expect(modelInfo('a/gone')).rejects.toThrow('no public model');
    expect(await modelInfo('a/other')).toBeNull();
    await expect(modelInfo('../etc')).rejects.toThrow();
  });

  it('opens the Models sheet only for a link that passes the page’s own check', async () => {
    let take = { ok: { repo: 'a/b', file: '../../x.gguf' } as unknown };
    let fire: () => void = () => {};
    vi.stubGlobal('window', { quoDesktop: { links: { take: async () => take, onOpen: (callback: () => void) => { fire = callback; return () => {}; } } } });
    const opened: string[] = [];
    listenForModelLinks(() => opened.push('open'));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(opened).toEqual([]);
    take = { ok: { repo: 'a/b' } };
    fire();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(opened).toEqual(['open']);
  });
});
