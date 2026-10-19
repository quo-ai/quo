import type { ModelChoice } from '../models';

export interface RouteState {
  choice: ModelChoice;
  /** Code mode could be used with this model (desktop app, and the model can use tools). */
  available: boolean;
  /** The setting that lets the model open a folder itself. */
  autoStart: boolean;
  /** An offline model that isn't trusted for Code mode and hasn't been allowed. */
  gated: boolean;
  /** An offline model rated good at calling tools. Small ones decide badly when to use them, so only these decide for themselves. */
  localRated?: boolean;
  /** Something the tool loop doesn't do is in play: attachments, thinking, or a web search through tools / Quo's own search. */
  plainFeatures: boolean;
}

/**
 * Whether a chat with no folder yet goes through the tool loop, so the model can ask for a folder itself (open_project).
 * Anything the loop doesn't do keeps its ordinary route. A cloud model also needs a server that knows this protocol:
 * the desktop app talks to the hosted API, which can be an older build than the app (the server sends `agentLight` on
 * every model since the folder-less protocol came in), and an older server would turn the request away.
 */
export function usesFolderLoop({ choice, available, autoStart, gated, localRated = true, plainFeatures }: RouteState): boolean {
  if (!available || !autoStart || plainFeatures) return false;
  if (choice.kind === 'local') return !gated && localRated;
  if (choice.kind === 'cloud') return 'agentLight' in choice.model;
  return true;
}
