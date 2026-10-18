import { agentBridge, NativeError, unwrap, type CodeProject, type CodeSessionInfo, type DesktopAgent, type UndoResult } from '../native';
import type { ToolResult } from './types';

/** The project a person last used, so turning Code mode on again needs no dialog. */
const LAST_KEY = 'quo.codeProject';

export const lastProjectId = (): string | null => {
  try {
    return localStorage.getItem(LAST_KEY);
  } catch {
    return null;
  }
};
const remember = (id: string) => {
  try {
    localStorage.setItem(LAST_KEY, id);
  } catch {
    // Private mode: it just won't be remembered.
  }
};

/** A running Code session: a project folder, and the tools that work in it. */
export class CodeSession {
  /** Plan mode: only reading. The desktop app enforces it too, so this is what the model is offered, not the rule. */
  plan = false;

  private constructor(private bridge: DesktopAgent, readonly info: CodeSessionInfo, readonly project: CodeProject) {}

  /** The tools to offer the model right now. */
  get tools(): string[] {
    return this.plan ? this.info.planTools : this.info.tools;
  }

  async setPlan(plan: boolean): Promise<void> {
    unwrap(await this.bridge.mode(this.info.sessionId, plan ? 'plan' : 'work'));
    this.plan = plan;
  }

  /** Takes back the last `count` changes the agent made, wherever the files are still as it left them. */
  async undo(count: number): Promise<UndoResult> {
    return unwrap(await this.bridge.undo(this.info.sessionId, count));
  }

  static async start(project: CodeProject): Promise<CodeSession> {
    const bridge = agentBridge();
    if (!bridge) throw new NativeError('unavailable', 'Code mode needs the Quo desktop app.');
    const info = unwrap(await bridge.start(project.id));
    remember(project.id);
    return new CodeSession(bridge, info, project);
  }

  /** Runs a tool. A failure comes back as a result the model can read, never as an exception. */
  async run(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    try {
      return unwrap(await this.bridge.tool(this.info.sessionId, name, args));
    } catch (error) {
      return { ok: false, text: error instanceof NativeError ? error.message : 'That didn’t work.', display: { kind: 'error' } };
    }
  }

  /** Stops whatever tool is running (a command is killed). */
  stop(): void {
    void this.bridge.abort(this.info.sessionId).catch(() => {});
  }

  end(): void {
    void this.bridge.end(this.info.sessionId).catch(() => {});
  }
}

export async function recentProjects(): Promise<CodeProject[]> {
  const bridge = agentBridge();
  return bridge ? unwrap(await bridge.projects()).slice() : [];
}

/** Opens the folder dialog. Null if the person cancels. */
export async function pickProject(): Promise<CodeProject | null> {
  const bridge = agentBridge();
  return bridge ? unwrap(await bridge.pick()) : null;
}
