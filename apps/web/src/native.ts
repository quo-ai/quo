import type { ThinkChoice } from '../shared/thinking';
import type { ChatReply } from './providers/wire';

/**
 * The desktop app's native engine, as seen from the web app. The preload
 * script (apps/desktop/src/preload.js) adds `engine` and `models` to
 * `window.quoDesktop` only in builds that include llama.cpp; everywhere else
 * these are absent and Quo uses its in-browser engine.
 *
 * Every call resolves to `{ ok }` or `{ error: { code, message } }`;
 * `unwrap` turns that into a value or a thrown NativeError.
 */

/** Code mode's approval levels: ask every time, ask only for risky steps, or don't ask (pushes always ask). */
export type Autonomy = 'ask' | 'risky' | 'all';

/** The local server for other apps: whether it's on, where, and the key to give them. */
export interface LocalServerState { on: boolean; port: number; address: string; key: string }

/** A tool server (MCP) from the person's own file, as main describes it: never what it runs or its settings. */
export interface ToolServer {
  name: string;
  state: 'off' | 'starting' | 'on' | 'error' | 'changed' | 'disabled' | 'problem';
  message?: string;
  tools: { name: string; description: string }[];
}
export interface ToolServersState { servers: ToolServer[]; problem?: string }

/** An image model file the person added in the desktop app, as main describes it (no path). */
export interface OwnImageModel { id: string; name: string; family: string; label: string; steps: number; cfg: number; edits: boolean; needs?: string }

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

export interface AcceleratorStatus {
  /** There is a faster build for this computer's graphics card. */
  available: boolean;
  label: string | null;
  bytes: number;
  installed: boolean;
  installing: boolean;
  /** The person wants it used (they can turn it off). */
  use: boolean;
  /** Why it was set aside after failing to start, or null. */
  failed: string | null;
  /** The engine runs from it right now. */
  active: boolean;
}

export type AcceleratorEvent =
  | { type: 'progress'; loaded: number; total: number }
  | { type: 'done'; status: AcceleratorStatus }
  | { type: 'error'; code: string; message: string };

export interface NativeStatus {
  running: boolean;
  modelId?: string;
  backend?: string;
  device?: string | null;
  vision?: boolean;
  /** The context window the engine was started with (smaller than asked for when the model did not fit with it). */
  contextSize?: number;
  /** The window that was asked for, so a model that settled on less is not loaded again every time. */
  requestedContextSize?: number;
  /** The computer has a graphics card the engine could use. */
  gpuAvailable?: boolean;
  /** Drafting several tokens a step (a prediction head or a drafter file). */
  mtp?: boolean;
  /** How the window is stored: 16 bits, or 8 where memory was short. */
  kvType?: 'f16' | 'q8_0';
}

export interface ModelFileRequest {
  url: string;
  name: string;
  sizeBytes: number;
  /** Sizes an earlier edition had (state only): such a file counts as downloaded. */
  altSizes?: number[];
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
    /** `kvType` 'q8_0' stores the window in 8 bits (tuning.ts windowFor); the engine falls back to 16 if it can't. */
    start: (options: { modelId: string; contextSize: number; kvType?: 'f16' | 'q8_0' }) => Promise<NativeResult<NativeStatus>>;
    stop: () => Promise<NativeResult<unknown>>;
    onEvent: (callback: (event: { type: 'exit'; code: number | null; signal: string | null }) => void) => () => void;
    /** A faster engine for the graphics card (desktop accelerators.js); missing in older desktop builds. */
    accelerator?: {
      status: () => Promise<NativeResult<AcceleratorStatus>>;
      install: () => Promise<NativeResult<boolean>>;
      cancel: () => Promise<NativeResult<unknown>>;
      use: (on: boolean) => Promise<NativeResult<AcceleratorStatus>>;
      remove: () => Promise<NativeResult<AcceleratorStatus>>;
      onEvent: (callback: (event: AcceleratorEvent) => void) => () => void;
    };
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
  /** Roughly where it is (the last few folders, home as ~), to tell two with the same name apart. Never the full path. */
  hint?: string;
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
  hint?: string;
  /** The branch and how many files have changed, when the project is a git repository. */
  git?: { branch: string | null; changed: number } | null;
}

/** One entry in a folder, for the file panel. */
export interface FileEntry {
  name: string;
  /** Relative to the project, with forward slashes. */
  path: string;
  dir: boolean;
  /** A folder of dependencies or build output: shown dimmed and not opened by itself. */
  ignored: boolean;
}

export interface FolderListing {
  path: string;
  entries: FileEntry[];
  truncated: boolean;
}

/** One file for the viewer: text, an image as a data address, or why it can't be shown. */
export interface FileView {
  path: string;
  size: number;
  /** A browser can show it (a page, image or document), so "Open in browser" is offered. */
  canOpen: boolean;
  kind: 'text' | 'image' | 'binary' | 'toolarge';
  text?: string;
  lines?: number;
  clipped?: boolean;
  dataUrl?: string;
}

/** A file the agent changed in this session, with the change. */
export interface FileChange {
  path: string;
  created: boolean;
  added: number;
  removed: number;
  diff: string;
}

export interface UndoResult {
  restored: string[];
  /** Left alone because they changed again after the agent's change. */
  skipped: string[];
}

export interface DesktopAgent {
  projects: () => Promise<NativeResult<CodeProject[]>>;
  pick: () => Promise<NativeResult<CodeProject | null>>;
  /** Makes a new empty project folder under Documents/Quo Projects, named from these words. */
  workspace: (name: string) => Promise<NativeResult<CodeProject>>;
  forget: (id: string) => Promise<NativeResult<unknown>>;
  start: (projectId: string, options?: { autoReadOnly?: boolean; compact?: boolean; creditQuo?: boolean; allowPush?: boolean; confirm?: boolean }) => Promise<NativeResult<CodeSessionInfo>>;
  tool: (sessionId: string, name: string, args: Record<string, unknown>) => Promise<NativeResult<{ ok: boolean; text: string; display?: Record<string, unknown> }>>;
  mode: (sessionId: string, mode: 'work' | 'plan') => Promise<NativeResult<unknown>>;
  /** How much runs without asking (desktop agent/autonomy.js); main asks the person before loosening it. Older apps lack it. */
  autonomy?: (sessionId: string, level: Autonomy) => Promise<NativeResult<Autonomy>>;
  /** Files in the project matching part of a name, best first. */
  files: (sessionId: string, query: string) => Promise<NativeResult<string[]>>;
  undo: (sessionId: string, count: number) => Promise<NativeResult<UndoResult>>;
  /** The file panel: reading only, with the rules the agent's own reading has. */
  browse: (sessionId: string, path: string) => Promise<NativeResult<FolderListing>>;
  view: (sessionId: string, path: string) => Promise<NativeResult<FileView>>;
  exists: (sessionId: string, paths: string[]) => Promise<NativeResult<string[]>>;
  changes: (sessionId: string) => Promise<NativeResult<FileChange[]>>;
  /** Open a page in the browser (approved in the desktop app's own window), or show a project file in the file manager. */
  open: (sessionId: string, target: string) => Promise<NativeResult<{ ok: boolean; text: string }>>;
  reveal: (sessionId: string, path: string) => Promise<NativeResult<unknown>>;
  abort: (sessionId: string) => Promise<NativeResult<unknown>>;
  end: (sessionId: string) => Promise<NativeResult<unknown>>;
  clearRepos: () => Promise<NativeResult<unknown>>;
}

declare global {
  interface Window {
    quoDesktop?: {
      platform: string;
      version: string;
      appearance?: { set: (mode: 'system' | 'light' | 'dark', look: import('./styles/appearances').AppearanceName) => Promise<unknown> };
      agent?: DesktopAgent;
      providers?: DesktopProviders;
      claude?: DesktopClaude;
      web?: DesktopWeb;
      engine?: NativeBridge['engine'];
      models?: NativeBridge['models'];
      /** The local server for other apps (apps/desktop/src/server/localApi.js). Older apps lack it. */
      toolServers?: {
        state: () => Promise<NativeResult<ToolServersState>>;
        tools: () => Promise<NativeResult<unknown>>;
        set: (name: string, on: boolean) => Promise<NativeResult<ToolServersState>>;
        reload: () => Promise<NativeResult<ToolServersState>>;
        edit: () => Promise<NativeResult<boolean>>;
        call: (chatId: string, name: string, args: Record<string, unknown>) => Promise<NativeResult<{ ok: boolean; text: string; display?: Record<string, unknown> & { kind?: string } }>>;
        abort: (chatId: string) => Promise<NativeResult<unknown>>;
        onEvent: (callback: (state: ToolServersState) => void) => () => void;
      };
      localServer?: {
        state: () => Promise<NativeResult<LocalServerState>>;
        set: (on: boolean) => Promise<NativeResult<LocalServerState>>;
        renewKey: () => Promise<NativeResult<LocalServerState>>;
        setPort: (port: number) => Promise<NativeResult<LocalServerState>>;
      };
      /** Images made on this computer (apps/desktop/src/images/): a downloaded image model's id, a prompt and a shape. */
      images?: {
        make: (request: { modelId: string; prompt: string; aspect: string; steps?: number; cfg?: number; seed?: number; size?: 'standard' | 'quick'; reference?: string }) => Promise<NativeResult<{ image: string; seed: number; setAside?: boolean }>>;
        cancel: () => Promise<NativeResult<unknown>>;
        onEvent: (callback: (event: { type: 'progress'; step: number; steps: number }) => void) => () => void;
        /** The person's own image model files (apps/desktop/src/images/custom.js): never a path. Older apps lack it. */
        custom?: {
          list: () => Promise<NativeResult<OwnImageModel[]>>;
          pick: () => Promise<NativeResult<OwnImageModel | null>>;
          remove: (id: string) => Promise<NativeResult<unknown>>;
        };
      };
      /** quo:// links (apps/desktop/src/links.js): told that one came, then takes the model main checked. */
      links?: { take: () => Promise<NativeResult<{ repo: string; file?: string } | null>>; onOpen: (callback: () => void) => () => void };
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

/**
 * Claude Agent (apps/desktop/src/claude): Claude through the person's own Claude Code login. The page sends a
 * conversation and gets the reply back as events; it never sees the login and can't choose the program or its settings.
 */
export interface ClaudeStatus {
  installed: boolean;
  version?: string | null;
  /** Something to fix first (too old, didn't start). */
  problem?: string | null;
  signedIn?: boolean;
  /** How Claude Code is signed in: a Claude plan, an API key or a cloud provider. */
  kind?: 'subscription' | 'api_key' | 'cloud' | null;
  /** The Claude plan's name, when it says. */
  plan?: string | null;
  /**
   * Claude Code's own rows (short names that always mean the newest), then specific versions (`pinned`). `thinking`: how
   * it thinks under Claude Code. `contextTokens`: its window, once checked.
   */
  models?: ClaudeModel[];
  /** The specific versions are still being checked; `models()` gives the full list when that is done. */
  checking?: boolean;
}

export interface ClaudeModel {
  id: string;
  name: string;
  description: string;
  pinned?: boolean;
  /** The efforts it takes, Claude Code's default effort for it, and whether thinking can be turned off. */
  thinking?: { efforts: string[]; default: string | null; off: boolean };
  contextTokens?: number;
  /** For a short name: the exact model it stands for now ("claude-sonnet-5-5" for "sonnet"). */
  resolved?: string;
}

export type ClaudeEvent =
  | { id: string; type: 'update'; content: string; reasoning: string }
  | { id: string; type: 'done'; reply: ChatReply }
  | { id: string; type: 'error'; code: string; message: string };

export interface DesktopClaude {
  status: (options: { check: boolean }) => Promise<NativeResult<ClaudeStatus>>;
  models: () => Promise<NativeResult<ClaudeModel[] | null>>;
  request: (request: { id: string; model: string; messages: unknown[]; tools?: unknown[]; effort?: ThinkChoice; oneOff?: boolean }) => Promise<NativeResult<unknown>>;
  abort: (id: string) => Promise<NativeResult<unknown>>;
  onEvent: (callback: (event: ClaudeEvent) => void) => () => void;
}

/** The Claude Agent bridge, or null in the browser and in desktop builds from before it. */
export const claudeBridge = (): DesktopClaude | null => (typeof window === 'undefined' ? null : window.quoDesktop?.claude ?? null);

/** Web search and page reading (apps/desktop/src/web). A search key can be saved or cleared but never read back. */
export interface WebBackendState {
  id: string;
  name: string;
  needsKey: boolean;
  needsUrl: boolean;
  keyUrl: string | null;
  /** Ready to use: a key is saved, an address is set, or it needs neither. */
  configured: boolean;
  last4: string | null;
}

export interface WebState {
  backend: string;
  searxngUrl: string | null;
  /** Keys are kept encrypted by the system (otherwise only until Quo quits). */
  secure: boolean;
  backends: WebBackendState[];
}

export interface WebToolResult {
  text: string;
  display?: Record<string, unknown>;
}

export interface DesktopWeb {
  state: () => Promise<NativeResult<WebState>>;
  configure: (patch: { backend?: string; searxngUrl?: string | null }) => Promise<NativeResult<WebState>>;
  setKey: (backend: string, key: string) => Promise<NativeResult<WebState>>;
  clearKey: (backend: string) => Promise<NativeResult<WebState>>;
  allow: (sessionId: string, urls: string[]) => Promise<NativeResult<unknown>>;
  search: (sessionId: string, query: string, options?: { count?: number; compact?: boolean }) => Promise<NativeResult<WebToolResult>>;
  read: (sessionId: string, url: string, options?: { compact?: boolean }) => Promise<NativeResult<WebToolResult>>;
}

/** The web bridge, or null in the browser and in desktop builds from before it. */
export const webBridge = (): DesktopWeb | null => (typeof window === 'undefined' ? null : window.quoDesktop?.web ?? null);
