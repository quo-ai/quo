import { describe, expect, it } from 'vitest';
import { DESKTOP_MODELS } from '../catalog';
import { detectBrowser, deviceNotice, modelFit, recommendedModelId, type DeviceProfile } from '../device';
import type { NativeInfo } from '../native';

const base: DeviceProfile = {
  gpu: false, webgpu: false, jspi: false, browser: 'chrome', gpuName: null,
  memoryGB: 8, cores: 8, multiThread: true, mobile: false,
};

describe('detectBrowser', () => {
  it.each([
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36 Edg/141.0', 'edge'],
    ['Mozilla/5.0 (X11; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0', 'firefox'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36', 'chrome'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 15_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15', 'safari'],
  ])('%s', (ua, expected) => {
    expect(detectBrowser(ua)).toBe(expected);
  });
});

describe('deviceNotice', () => {
  it('says nothing when the GPU is in use', () => {
    expect(deviceNotice({ ...base, gpu: true, webgpu: true, jspi: true })).toBeNull();
  });

  it('points Firefox and Safari users to Chrome or Edge', () => {
    expect(deviceNotice({ ...base, browser: 'firefox', webgpu: true })?.id).toBe('firefox');
    expect(deviceNotice({ ...base, browser: 'safari', webgpu: true })?.message).toMatch(/Chrome or Edge/);
  });

  it('asks for a browser update when WebGPU exists but JSPI does not', () => {
    expect(deviceNotice({ ...base, webgpu: true, jspi: false })?.id).toBe('update-browser');
  });

  it('explains a missing graphics card otherwise', () => {
    expect(deviceNotice({ ...base, webgpu: true, jspi: true })?.id).toBe('no-gpu');
  });

  it('gives phones their own notice, even with a GPU', () => {
    expect(deviceNotice({ ...base, mobile: true, gpu: true })?.id).toBe('mobile');
  });
});

describe('desktop app (native engine)', () => {
  const GB = 2 ** 30;
  const machine = (vramGB: number | null, ramGB: number): DeviceProfile => {
    const native: NativeInfo = {
      available: true, release: 'b1', platform: 'linux', arch: 'x64', cpus: 8, modelsDir: '/models',
      ramBytes: ramGB * GB, freeRamBytes: ramGB * GB,
      devices: vramGB === null ? [] : [{ id: 'Vulkan0', backend: 'vulkan', name: 'Test GPU', totalMiB: vramGB * 1024, freeMiB: vramGB * 1024 }],
    };
    return { ...base, gpu: vramGB !== null, gpuName: vramGB === null ? null : 'Test GPU', memoryGB: ramGB, native };
  };
  const model = (id: string) => DESKTOP_MODELS.find(m => m.id === id)!;

  it('offers vision with every Qwen3.5 size and the larger ones the browser cannot hold', () => {
    expect(DESKTOP_MODELS.filter(m => m.id.startsWith('qwen35')).every(m => m.vision)).toBe(true);
    expect(DESKTOP_MODELS.some(m => m.files.some(f => f.sizeBytes > 2 ** 31))).toBe(true);
  });

  it('says nothing about the graphics card when one is found, and explains CPU-only', () => {
    expect(deviceNotice(machine(8, 32))).toBeNull();
    expect(deviceNotice(machine(null, 16))?.id).toBe('native-cpu');
  });

  it('judges fit by real graphics memory, not the browser\'s 8 GB cap', () => {
    expect(modelFit(model('qwen35-4b'), machine(8, 32))).toBe('good');
    expect(modelFit(model('qwen35-27b'), machine(8, 32))).toBe('slow'); // spills onto the processor
    expect(modelFit(model('qwen35-27b'), machine(8, 16))).toBe('too-big');
  });

  it('marks big models slow on a processor and refuses ones that do not fit in memory', () => {
    expect(modelFit(model('qwen35-0.8b'), machine(null, 8))).toBe('good');
    expect(modelFit(model('qwen35-9b'), machine(null, 16))).toBe('slow');
    expect(modelFit(model('qwen35-9b'), machine(null, 8))).toBe('too-big');
  });

  it('is not thrown off by memory other apps are using', () => {
    const busy = machine(8, 32);
    busy.native!.devices[0].freeMiB = 3900;
    expect(modelFit(model('qwen35-4b'), busy)).toBe('good');
  });

  it('recommends the biggest model that runs well', () => {
    expect(recommendedModelId(machine(24, 64), DESKTOP_MODELS)).toBe('qwen35-9b');
    expect(recommendedModelId(machine(6, 16), DESKTOP_MODELS)).toBe('qwen35-4b');
    expect(recommendedModelId(machine(4, 8), DESKTOP_MODELS)).toBe('qwen35-2b');
    expect(recommendedModelId(machine(2, 8), DESKTOP_MODELS)).toBe('qwen35-0.8b');
  });

  it('keeps a processor-only computer to small models', () => {
    expect(['qwen35-0.8b', 'qwen35-2b']).toContain(recommendedModelId(machine(null, 64), DESKTOP_MODELS));
    expect(recommendedModelId(machine(null, 4), DESKTOP_MODELS)).toBe('qwen35-0.8b');
  });
});
