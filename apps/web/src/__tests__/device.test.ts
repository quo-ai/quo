import { describe, expect, it } from 'vitest';
import { detectBrowser, deviceNotice, type DeviceProfile } from '../device';

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
