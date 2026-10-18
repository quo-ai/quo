/**
 * The desktop app's native engine, as seen from the web app. The preload
 * script (apps/desktop/src/preload.js) adds `engine` and `models` to
 * `window.quoDesktop` only in builds that include llama.cpp; everywhere else
 * these are absent and Quo uses its in-browser engine.
 *
 * Every call resolves to `{ ok }` or `{ error: { code, message } }`;
 * `unwrap` turns that into a value or a thrown NativeError.
 */

export interface NativeFailure {
  code: string;
  message: string;
}

export type NativeResult<T> = { ok: T; error?: undefined } | { ok?: undefined; error: NativeFailure };

export class NativeError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

export function unwrap<T>(result: NativeResult<T>): T {
  if (result.error) throw new NativeError(result.error.code, result.error.message);
  return result.ok as T;
}

export interface GpuDevice {
  id: string;
  /** 'vulkan' | 'metal' | 'cuda' | … */
  backend: string;
  name: string;
  totalMiB: number;
  freeMiB: number;
}

export interface NativeInfo {
  available: boolean;
  release: string;
  platform: string;
  arch: string;
  ramBytes: number;
  freeRamBytes: number;
  cpus: number;
  devices: GpuDevice[];
  modelsDir: string;
}

export interface NativeStatus {
  running: boolean;
  modelId?: string;
  backend?: string;
  device?: string | null;
  vision?: boolean;
}

export interface ModelFileRequest {
  url: string;
  name: string;
  sizeBytes: number;
}

export interface ModelDiskInfo {
  installed: boolean;
  downloadedBytes: number;
  totalBytes: number;
}

export interface ModelEvent {
  modelId: string;
  type: 'progress' | 'waiting' | 'verifying' | 'done' | 'error';
  loaded?: number;
  total?: number;
  code?: string;
}

/** A model the user already has on this computer, used where it is. */
export interface CustomModelEntry {
  id: string;
  name: string;
  path: string;
  sizeBytes: number;
  mmprojPath?: string;
  source?: 'lmstudio' | 'ollama';
}

export interface NativeBridge {
  engine: {
    info: () => Promise<NativeResult<NativeInfo>>;
    status: () => Promise<NativeResult<NativeStatus>>;
    start: (options: { modelId: string; contextSize: number }) => Promise<NativeResult<NativeStatus>>;
    stop: () => Promise<NativeResult<unknown>>;
    onEvent: (callback: (event: { type: 'exit'; code: number | null; signal: string | null }) => void) => () => void;
  };
  models: {
    state: (modelId: string, files: ModelFileRequest[]) => Promise<NativeResult<ModelDiskInfo>>;
    download: (modelId: string, files: ModelFileRequest[]) => Promise<NativeResult<boolean>>;
    cancel: (modelId: string) => Promise<NativeResult<unknown>>;
    remove: (modelId: string) => Promise<NativeResult<unknown>>;
    reveal: () => Promise<NativeResult<unknown>>;
    onEvent: (callback: (event: ModelEvent) => void) => () => void;
    custom: {
      list: () => Promise<NativeResult<CustomModelEntry[]>>;
      scan: () => Promise<NativeResult<CustomModelEntry[]>>;
      add: (path: string, options?: { name?: string; mmprojPath?: string }) => Promise<NativeResult<CustomModelEntry>>;
      pick: () => Promise<NativeResult<CustomModelEntry | null>>;
      remove: (id: string) => Promise<NativeResult<unknown>>;
    };
  };
}

/**
 * Code mode (apps/desktop/src/agent). The page never names a folder or approves anything:
 * the project is chosen in a native dialog and held here only as an id, and edits and
 * commands are approved in native dialogs too.
 */
export interface CodeProject {
  id: string;
  name: string;
}

export interface CodeSessionInfo {
  sessionId: string;
  name: string;
  platform: string;
  /** The tools this build implements. */
  tools: string[];
  /** The ones that only read, for plan mode. */
  planTools: string[];
  /** The project's own notes for coding agents (AGENTS.md or CLAUDE.md), if it has any. */
  instructions: { file: string; text: string } | null;
}

export interface UndoResult {
  restored: string[];
  /** Left alone because they changed again after the agent's change. */
  skipped: string[];
}

export interface DesktopAgent {
  projects: () => Promise<NativeResult<CodeProject[]>>;
  pick: () => Promise<NativeResult<CodeProject | null>>;
  forget: (id: string) => Promise<NativeResult<unknown>>;
  start: (projectId: string, options?: { autoReadOnly?: boolean }) => Promise<NativeResult<CodeSessionInfo>>;
  tool: (sessionId: string, name: string, args: Record<string, unknown>) => Promise<NativeResult<{ ok: boolean; text: string; display?: Record<string, unknown> }>>;
  mode: (sessionId: string, mode: 'work' | 'plan') => Promise<NativeResult<unknown>>;
  undo: (sessionId: string, count: number) => Promise<NativeResult<UndoResult>>;
  abort: (sessionId: string) => Promise<NativeResult<unknown>>;
  end: (sessionId: string) => Promise<NativeResult<unknown>>;
  clearRepos: () => Promise<NativeResult<unknown>>;
}

declare global {
  interface Window {
    quoDesktop?: {
      platform: string;
      version: string;
      agent?: DesktopAgent;
      providers?: DesktopProviders;
      engine?: NativeBridge['engine'];
      models?: NativeBridge['models'];
    };
  }
}

/** The native engine's bridge, or null in the browser and in builds without llama.cpp. */
export function nativeBridge(): NativeBridge | null {
  if (typeof window === 'undefined') return null;
  const { engine, models } = window.quoDesktop ?? {};
  return engine && models ? { engine, models } : null;
}

export const hasNativeEngine = (): boolean => nativeBridge() !== null;

/** Code mode's bridge, or null in the browser and in desktop builds from before it. */
export const agentBridge = (): DesktopAgent | null => (typeof window === 'undefined' ? null : window.quoDesktop?.agent ?? null);

/**
 * Providers (apps/desktop/src/providers): the user's own API keys. The page can store or remove a key but
 * never read one back; requests to a provider go through the main process, which adds the key itself.
 */
export interface ProviderState {
  id: string;
  configured: boolean;
  /** The last four characters of the key, to tell keys apart. */
  last4: string | null;
}

export interface CustomProviderEntry {
  id: string;
  name: string;
  baseUrl: string;
  protocol: 'openai' | 'anthropic';
}

export type ProviderEvent =
  | { id: string; type: 'head'; status: number }
  | { id: string; type: 'chunk'; data: Uint8Array }
  | { id: string; type: 'end' }
  | { id: string; type: 'error'; message: string };

export interface DesktopProviders {
  list: () => Promise<NativeResult<{ keys: ProviderState[]; custom: CustomProviderEntry[]; secure: boolean }>>;
  setKey: (id: string, key: string) => Promise<NativeResult<unknown>>;
  clearKey: (id: string) => Promise<NativeResult<unknown>>;
  saveCustom: (entry: { id?: string; name: string; baseUrl: string; protocol: 'openai' | 'anthropic'; key?: string }) => Promise<NativeResult<CustomProviderEntry>>;
  removeCustom: (id: string) => Promise<NativeResult<unknown>>;
  request: (request: { id: string; providerId: string; method: 'GET' | 'POST'; path: string; body?: unknown }) => Promise<NativeResult<unknown>>;
  abort: (id: string) => Promise<NativeResult<unknown>>;
  onEvent: (callback: (event: ProviderEvent) => void) => () => void;
}

/** The provider bridge, or null in the browser and in desktop builds from before it. */
export const providersBridge = (): DesktopProviders | null => (typeof window === 'undefined' ? null : window.quoDesktop?.providers ?? null);
