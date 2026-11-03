import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GeneratedImages } from '../chat/GeneratedImages';

describe('images in a reply', () => {
  it('open full size when clicked, but only once they are made', () => {
    const html = renderToStaticMarkup(createElement(GeneratedImages, { images: [
      { id: 'a', prompt: 'a lighthouse', aspect: '16:9', status: 'done', dataUrl: 'data:image/png;base64,AAAA', model: 'Z-Image Turbo', where: 'device' },
      { id: 'b', prompt: 'a cat', aspect: '1:1', status: 'creating', progress: { step: 3, steps: 8 } },
      { id: 'c', prompt: 'a dog', aspect: '1:1', status: 'failed', error: 'Stopped.' },
    ] }));
    expect(html.match(/class="image-open"/g)).toHaveLength(1);
    expect(html).toContain('aria-label="See full size: a lighthouse"');
    expect(html).toContain('Step 3 of 8');
    expect(html).toContain('On this computer');
    expect(html).not.toContain('role="dialog"'); // the viewer opens only when asked
  });
});
