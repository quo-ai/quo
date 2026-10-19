import type { AgentStep } from '../agent/types';

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/**
 * The searches a provider ran for a reply (Quo's server, or the user's own OpenRouter or Anthropic key), as steps the
 * chat already knows how to draw: "Searching the web for …" while it runs, "Searched the web for …" once the answer
 * comes. The desktop's own search tools make their steps in the agent loop instead.
 */
export class SearchSteps {
  private steps: AgentStep[] = [];
  private words = new Map<string, string>();
  /** How much of the answer there was when the last search started. */
  private textAtSearch = 0;

  /** A search started (with `textSoFar` characters of answer before it); the one before it, if any, is finished. */
  start(query: string, textSoFar = 0): AgentStep[] {
    this.settle();
    this.textAtSearch = textSoFar;
    const words = clip(query.trim(), 60);
    const id = crypto.randomUUID();
    if (words) this.words.set(id, words);
    this.steps.push({ id, tool: 'web_search', title: words ? `Searching the web for “${words}”…` : 'Searching the web…', status: 'running' });
    return this.list();
  }

  /** The words of the search in progress, when they arrive after it started (Anthropic streams them). */
  name(query: string): AgentStep[] {
    const running = this.steps.at(-1);
    const words = clip(query.trim(), 60);
    if (running?.status === 'running' && words) {
      this.words.set(running.id, words);
      running.title = `Searching the web for “${words}”…`;
    }
    return this.list();
  }

  /** More answer has arrived since the search started, so it is over: the steps once they change, else null. */
  answering(textSoFar: number): AgentStep[] | null {
    if (textSoFar <= this.textAtSearch || !this.steps.some(step => step.status === 'running')) return null;
    this.settle();
    return this.list();
  }

  /** The reply is done: every search is finished, and one the provider only counted gets a step of its own. */
  finish(searched: boolean, stopped = false): AgentStep[] | undefined {
    this.settle(stopped);
    if (searched && !this.steps.length) this.steps.push({ id: crypto.randomUUID(), tool: 'web_search', title: 'Searched the web', status: 'done' });
    return this.steps.length ? this.list() : undefined;
  }

  private settle(stopped = false) {
    for (const step of this.steps) {
      if (step.status !== 'running') continue;
      step.status = stopped ? 'stopped' : 'done';
      const words = this.words.get(step.id);
      step.title = words ? `Searched the web for “${words}”` : 'Searched the web';
    }
  }

  private list(): AgentStep[] {
    return this.steps.map(step => ({ ...step }));
  }
}
