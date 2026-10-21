import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AcceleratorStatus } from '../../native';

const bridge = vi.hoisted(() => ({ value: null as unknown }));
vi.mock('../../native', () => ({ nativeBridge: () => bridge.value, unwrap: (r: { ok: unknown }) => r.ok }));

const { EngineAccelerator, acceleratorNote } = await import('../EngineAccelerator');

const base: AcceleratorStatus = { available: true, label: 'NVIDIA CUDA 13', bytes: 594462145, installed: false, installing: false, use: true, failed: null, active: false };

describe('the faster engine for a graphics card', () => {
  it('says what it gives, where it comes from and its size before it is downloaded', () => {
    const note = acceleratorNote(base);
    expect(note).toMatch(/40% faster/);
    expect(note).toMatch(/llama\.cpp’s own releases/);
    expect(note).toMatch(/checked before use/);
    expect(note).toMatch(/\d+ MB/);
  });

  it('says when it runs, when it is off, and when it failed and Quo went back', () => {
    expect(acceleratorNote({ ...base, installed: true, active: true })).toContain('Running on the faster engine');
    expect(acceleratorNote({ ...base, installed: true, use: false })).toContain('turned off');
    expect(acceleratorNote({ ...base, installed: true, active: false, failed: 'engine_failed' })).toContain('went back to the one it came with');
  });

  it('shows nothing in a browser, or in a desktop build without it', () => {
    bridge.value = null;
    expect(renderToStaticMarkup(createElement(EngineAccelerator))).toBe('');
    bridge.value = { engine: {} };
    expect(renderToStaticMarkup(createElement(EngineAccelerator))).toBe('');
  });
});
