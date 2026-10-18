import { DEFAULT_LOCAL_MODEL_ID, type LocalModel } from './catalog';
import { isDesktopApp } from './platform';

/**
 * What this browser/computer can do, for model recommendations and for
 * choosing GPU vs CPU inference. Everything here is read locally.
 */

export type BrowserName = 'chrome' | 'edge' | 'firefox' | 'safari' | 'other';

export interface DeviceProfile {
  /** Real (non-software) WebGPU adapter and the JSPI support wllama needs for it. */
  gpu: boolean;
  /** The browser exposes WebGPU at all (navigator.gpu). */
  webgpu: boolean;
  /** WebAssembly JS Promise Integration, which wllama's GPU path requires. */
  jspi: boolean;
  browser: BrowserName;
  gpuName: string | null;
  /** navigator.deviceMemory (Chromium only, capped at 8); null when unknown. */
  memoryGB: number | null;
  cores: number;
  /** SharedArrayBuffer available, so CPU inference can use multiple threads. */
  multiThread: boolean;
  /** Phone or tablet browser: memory limits make local models impractical. */
  mobile: boolean;
}

interface GpuAdapterLike {
  info?: { vendor?: string; architecture?: string; description?: string; isFallbackAdapter?: boolean };
  isFallbackAdapter?: boolean;
}

let cached: Promise<DeviceProfile> | null = null;

export function getDeviceProfile(): Promise<DeviceProfile> {
  cached ??= detect();
  return cached;
}

async function detect(): Promise<DeviceProfile> {
  const nav = navigator as Navigator & { deviceMemory?: number; userAgentData?: { mobile?: boolean } };
  const webgpu = (navigator as unknown as {
    gpu?: { requestAdapter: (options?: object) => Promise<GpuAdapterLike | null> };
  }).gpu;

  let gpu = false;
  let gpuName: string | null = null;
  const jspi = typeof (WebAssembly as unknown as { Suspending?: unknown }).Suspending === 'function';
  if (webgpu && jspi) {
    try {
      const adapter = await webgpu.requestAdapter({ powerPreference: 'high-performance' });
      const fallback = adapter?.info?.isFallbackAdapter ?? adapter?.isFallbackAdapter ?? false;
      gpu = Boolean(adapter) && !fallback;
      const info = adapter?.info;
      gpuName = [info?.vendor, info?.architecture].filter(Boolean).join(' ') || info?.description || null;
    } catch {
      gpu = false;
    }
  }

  return {
    gpu,
    webgpu: Boolean(webgpu),
    jspi,
    browser: detectBrowser(navigator.userAgent),
    gpuName,
    memoryGB: nav.deviceMemory ?? null,
    cores: nav.hardwareConcurrency || 4,
    multiThread: globalThis.crossOriginIsolated === true,
    mobile: nav.userAgentData?.mobile ?? /Android|iPhone|iPad|iPod/i.test(navigator.userAgent),
  };
}

export function detectBrowser(userAgent: string): BrowserName {
  if (/Edg\//.test(userAgent)) return 'edge';
  if (/Firefox\/|FxiOS/.test(userAgent)) return 'firefox';
  if (/Chrome\/|Chromium\/|CriOS/.test(userAgent)) return 'chrome';
  if (/Safari\//.test(userAgent)) return 'safari';
  return 'other';
}

export interface DeviceNotice {
  /** Stable reason id; a dismissed notice stays hidden until the reason changes. */
  id: string;
  message: string;
}

const BROWSER_LABEL: Record<BrowserName, string> = {
  chrome: 'Chrome', edge: 'Edge', firefox: 'Firefox', safari: 'Safari', other: 'This browser',
};

/** Why replies may be slow here, and what would help; null when all is well. */
export function deviceNotice(device: DeviceProfile): DeviceNotice | null {
  if (device.mobile) {
    return { id: 'mobile', message: 'Phone browsers have limited memory for AI models. For the best experience on a phone, use the Quo app.' };
  }
  if (device.gpu) return null;
  if (device.browser === 'firefox' || device.browser === 'safari') {
    const name = BROWSER_LABEL[device.browser];
    return {
      id: device.browser,
      message: `${name} runs Quo on your processor, so replies are slower. For faster replies, open Quo in Chrome or Edge, or get the desktop app. Both can use your graphics card.`,
    };
  }
  if (isDesktopApp()) {
    return { id: 'desktop-no-gpu', message: 'Quo can’t reach your graphics card, so it runs on your processor and replies may be slower. Updating your graphics drivers, or Quo itself, can help.' };
  }
  if (device.webgpu && !device.jspi) {
    return { id: 'update-browser', message: 'Update your browser so Quo can use your graphics card for faster replies. Until then it runs on your processor.' };
  }
  return {
    id: 'no-gpu',
    message: 'Your graphics card isn’t available to this browser, so Quo runs on your processor and replies may be slower. Updating your browser or graphics drivers can help.',
  };
}

export type ModelFit = 'good' | 'slow' | 'too-big';

/** How well a model should run here. deviceMemory caps at 8, so 8 means "8 or more". */
export function modelFit(model: LocalModel, device: DeviceProfile): ModelFit {
  const memory = device.memoryGB ?? 8;
  if (memory < model.minMemoryGB / 2) return 'too-big';
  if (memory < model.minMemoryGB) return 'slow';
  if (!device.gpu && model.minMemoryGB >= 8) return 'slow';
  return 'good';
}

export function recommendedModelId(device: DeviceProfile): string {
  const memory = device.memoryGB ?? 8;
  return device.gpu && memory >= 8 ? 'qwen35-2b' : DEFAULT_LOCAL_MODEL_ID;
}
