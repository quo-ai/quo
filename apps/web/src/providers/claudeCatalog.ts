import { useSyncExternalStore } from 'react';
import { claudeBridge, type ClaudeModel, type ClaudeStatus } from '../native';
import { CLAUDE_AGENT, claudeModels, claudeStatus, listedModel } from './claudeAgent';
import { addOwnModel, ownModels } from './ownModels';

/**
 * The models Claude Code offers this person (Claude Agent), kept on this device so the model menu can list them
 * without starting Claude Code: its short names (always the newest) and the specific versions it accepted. Refreshed
 * whenever the Claude Agent page checks, and in the background when a day old (only for someone who uses it).
 */

interface Saved {
  models: ClaudeModel[];
  at: number;
}

const KEY = 'quo.claudeModels';
const DAY = 86_400_000;

function read(): Saved {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Saved> | null;
    const models = (Array.isArray(saved?.models) ? saved.models : []).filter((m): m is ClaudeModel => typeof m?.id === 'string' && typeof m.name === 'string');
    return { models, at: typeof saved?.at === 'number' ? saved.at : 0 };
  } catch {
    return { models: [], at: 0 };
  }
}

let saved: Saved | null = null;
const listeners = new Set<() => void>();
const current = (): Saved => (saved ??= read());

function save(models: ClaudeModel[]): void {
  saved = { models, at: Date.now() };
  try {
    localStorage.setItem(KEY, JSON.stringify(saved));
  } catch {
    // Private mode: it just won't survive a reload.
  }
  listeners.forEach(listener => listener());
  applyToUsed(models);
}

/** Models already in use get what Claude Code says now: their window, and what they offer for Thinking. */
function applyToUsed(models: ClaudeModel[]): void {
  for (const listed of models.map(listedModel)) {
    if (ownModels().some(model => model.provider === CLAUDE_AGENT.id && model.apiModel === listed.id)) addOwnModel(CLAUDE_AGENT, listed.id, { contextTokens: listed.contextTokens, thinking: listed.thinking ?? [], thinkingHints: listed.thinkingHints ?? {}, thinkingDefault: listed.thinkingDefault ?? null });
  }
}

const models = (): ClaudeModel[] => current().models;

/**
 * The exact model behind a model the person added, when its name doesn't say it: what a Claude Agent short name stands
 * for now ("claude-sonnet-5-5" for "sonnet"), or a provider's own id. Null when the name already is the id.
 */
export function exactModel(model: { name: string; apiModel: string }, offered: ClaudeModel[] = []): string | null {
  const id = offered.find(listed => listed.id === model.apiModel)?.resolved ?? model.apiModel;
  return id && id !== model.name ? id : null;
}

export function useClaudeModels(): ClaudeModel[] {
  return useSyncExternalStore(listener => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, models);
}

/**
 * Asks Claude Code again (no message is sent). `onStatus` gets the sign-in and Claude Code's own rows at once; the
 * specific versions follow when their check is done, and the promise settles then.
 */
export async function refreshClaudeModels(onStatus: (status: ClaudeStatus) => void = () => {}): Promise<ClaudeStatus> {
  const found = await claudeStatus(true);
  if (found.signedIn && !found.problem && found.models) {
    // Until the specific versions are checked again, the ones known before stay listed.
    save(found.checking ? [...found.models, ...models().filter(model => model.pinned)] : found.models);
  }
  onStatus(found);
  if (found.checking) {
    const full = await claudeModels().catch(() => null);
    if (full) save(full);
    return { ...found, checking: false, ...(full ? { models: full } : {}) };
  }
  return found;
}

let refreshing = false;
let applied = false;
/** Once a session, for someone who uses Claude Agent: refresh the list when it is a day old. */
export function refreshClaudeModelsIfOld(): void {
  // What the saved list says reaches the models in use at once (an app update can change how it is shown).
  if (!applied) {
    applied = true;
    applyToUsed(current().models);
  }
  // A list from an older version (short names without their exact model, models without how they think) is refreshed too.
  const dated = current().models.some(model => model.thinking === undefined || (!model.pinned && model.resolved === undefined && model.id !== 'default'));
  if (refreshing || !claudeBridge() || (Date.now() - current().at < DAY && !dated)) return;
  if (!current().models.length && !ownModels().some(model => model.provider === CLAUDE_AGENT.id)) return;
  refreshing = true;
  void refreshClaudeModels().catch(() => {});
}
