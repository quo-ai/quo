import { DEFAULT_LOCAL_MODEL_ID, LOCAL_MODELS, modelSizeBytes, type LocalModel } from './catalog';
import { nativeBridge, unwrap, type NativeInfo } from './native';
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
  /** The desktop app's native engine: the real graphics card and memory. Null in a browser. */
  native?: NativeInfo | null;
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

async function detectNative(): Promise<DeviceProfile | null> {
  const bridge = nativeBridge();
  if (!bridge) return null;
  try {
    const info = unwrap(await bridge.engine.info());
    if (!info.available) return null;
    const best = [...info.devices].sort((a, b) => b.freeMiB - a.freeMiB)[0];
    return {
      gpu: Boolean(best),
      webgpu: Boolean(best),
      jspi: true,
      browser: 'chrome',
      gpuName: best?.name ?? null,
      memoryGB: info.ramBytes / 2 ** 30,
      cores: info.cpus,
      multiThread: true,
      mobile: false,
      native: info,
    };
  } catch {
    return null;
  }
}

async function detect(): Promise<DeviceProfile> {
  const native = await detectNative();
  if (native) return native;
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
  if (device.native) {
    return device.gpu ? null : {
      id: 'native-cpu',
      message: 'Quo couldn’t find a supported graphics card, so it runs on your processor and replies may be slower. Smaller models are quicker.',
    };
  }
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

/**
 * Memory available to the native engine, in GB. For the graphics card this is
 * its free memory, but at least 70% of the total: what a browser or the desktop
 * happens to be using right now shouldn't change which models are suggested.
 */
function nativeMemory(device: DeviceProfile): { vramGB: number; ramGB: number } {
  const best = Math.max(0, ...(device.native?.devices ?? []).map(d => Math.max(d.freeMiB, d.totalMiB * 0.7)));
  return { vramGB: best / 1024, ramGB: (device.native?.ramBytes ?? 0) / 2 ** 30 };
}

/** How well a model should run here. deviceMemory caps at 8, so 8 means "8 or more". */
export function modelFit(model: LocalModel, device: DeviceProfile): ModelFit {
  if (device.native) {
    // Model files plus room for the context; a model bigger than the graphics
    // card still runs, partly on the processor, which is slower.
    const { vramGB, ramGB } = nativeMemory(device);
    const need = (modelSizeBytes(model) / 2 ** 30) * 1.15;
    if (vramGB && need + 1 <= vramGB) return 'good';
    if (need > ramGB * 0.8) return 'too-big';
    if (!vramGB) return need > 4 || need > ramGB * 0.5 ? 'slow' : 'good';
    return 'slow';
  }
  const memory = device.memoryGB ?? 8;
  if (memory < model.minMemoryGB / 2) return 'too-big';
  if (memory < model.minMemoryGB) return 'slow';
  if (!device.gpu && model.minMemoryGB >= 8) return 'slow';
  return 'good';
}

// Largest first; the biggest one that runs well here is suggested.
const NATIVE_PREFERENCE = ['qwen35-9b', 'qwen35-4b', 'qwen35-2b', 'qwen35-0.8b'];

export function recommendedModelId(device: DeviceProfile, models: LocalModel[] = LOCAL_MODELS): string {
  if (device.native) {
    const available = new Set(models.map(model => model.id));
    const pick = NATIVE_PREFERENCE.find(id => {
      const model = models.find(candidate => candidate.id === id);
      return available.has(id) && model && modelFit(model, device) === 'good' && (device.gpu || modelSizeBytes(model) < 3e9);
    });
    return pick ?? DEFAULT_LOCAL_MODEL_ID;
  }
  const memory = device.memoryGB ?? 8;
  return device.gpu && memory >= 8 ? 'qwen35-2b' : DEFAULT_LOCAL_MODEL_ID;
}
