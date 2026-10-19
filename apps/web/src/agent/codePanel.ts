import { useEffect, useSyncExternalStore } from 'react';
import type { CodeSession } from './session';

/**
 * The file panel's state, shared between the chat (which owns the Code session and knows when the agent is working) and the
 * panel, the toolbar button and the links in the messages. Plain external store, so none of them has to pass props through
 * the others.
 */

export type PanelTab = 'files' | 'changes';

export interface PanelState {
  session: CodeSession | null;
  /** The agent is working: the panel keeps itself up to date. */
  busy: boolean;
  /** Goes up when files may have changed. */
  tick: number;
  open: boolean;
  tab: PanelTab;
  /** The file being looked at, and the line to bring into view. */
  path: string | null;
  line: number | null;
  /** Which mentioned paths are real files in the project (true), or are not (false). Missing: not asked yet. */
  known: ReadonlyMap<string, boolean>;
}

const KEY = 'quo.filePanel';
const readOpen = () => {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
};

let state: PanelState = { session: null, busy: false, tick: 0, open: readOpen(), tab: 'files', path: null, line: null, known: new Map() };
const listeners = new Set<() => void>();
const set = (patch: Partial<PanelState>) => {
  state = { ...state, ...patch };
  listeners.forEach(listener => listener());
};
const remember = (open: boolean) => {
  try {
    localStorage.setItem(KEY, open ? '1' : '0');
  } catch {
    // Private mode: it just won't be remembered.
  }
};

// Paths mentioned in messages are checked with the project in one batch, a moment after the first is seen.
const pending = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;

async function resolvePending() {
  timer = null;
  const session = state.session;
  const paths = [...pending];
  pending.clear();
  if (!session || paths.length === 0) return;
  let found: string[] = [];
  try {
    found = await session.exists(paths);
  } catch {
    return;
  }
  if (state.session !== session) return; // another project by now
  const known = new Map(state.known);
  for (const path of paths) known.set(path, found.includes(path));
  set({ known });
}

export const codePanel = {
  get: (): PanelState => state,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  setSession(session: CodeSession | null) {
    if (session === state.session) return;
    pending.clear();
    set({ session, path: null, line: null, tab: 'files', known: new Map(), tick: state.tick + 1 });
  },
  setBusy(busy: boolean) {
    if (busy !== state.busy) set({ busy });
  },
  /** Files may have changed: refresh what is shown, and look again at paths that did not exist before. */
  bump() {
    const known = new Map([...state.known].filter(([, exists]) => exists));
    set({ tick: state.tick + 1, known });
  },
  toggle() {
    remember(!state.open);
    set({ open: !state.open });
  },
  close() {
    remember(false);
    set({ open: false });
  },
  setTab(tab: PanelTab) {
    set({ tab });
  },
  /** Looks inside a file: opens the panel on it (from a link in a message, say). */
  openFile(path: string, line?: number) {
    remember(true);
    set({ open: true, tab: 'files', path, line: line ?? null });
  },
  /** Closes the file being looked at, keeping the panel open. */
  closeFile() {
    set({ path: null, line: null });
  },
  /** Asks (once) whether a mentioned path is a real file of this project. */
  request(path: string) {
    if (!state.session || state.known.has(path) || pending.has(path)) return;
    pending.add(path);
    timer ??= setTimeout(() => void resolvePending(), 60);
  },
};

export const useCodePanel = (): PanelState => useSyncExternalStore(codePanel.subscribe, codePanel.get);

/** Whether a path named in a message is a real file in the project: undefined until it has been checked. */
export function useFileExists(path: string | null): boolean | undefined {
  const { known, session } = useCodePanel();
  useEffect(() => {
    if (path) codePanel.request(path);
  }, [path, session, known]);
  return path ? known.get(path) : undefined;
}
