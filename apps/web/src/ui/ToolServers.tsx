import { useEffect, useState } from 'react';
import { FileCog, RefreshCw } from 'lucide-react';
import { NativeError, unwrap, type NativeResult, type ToolServer, type ToolServersState } from '../native';
import { toast } from './Toasts';
import { Toggle } from './Toggle';

const bridge = () => (typeof window === 'undefined' ? null : window.quoDesktop?.toolServers ?? null);
export const hasToolServers = (): boolean => bridge() !== null;

const EXAMPLE = `{
  "mcpServers": {
    "files": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/a/folder"]
    }
  }
}`;

/** What a server is doing, in words. */
function stateText(server: ToolServer): string {
  if (server.state === 'on') return server.tools.length ? `On: ${server.tools.map(tool => tool.name).join(', ')}` : 'On, with no tools';
  if (server.state === 'starting') return 'Starting…';
  if (server.state === 'disabled') return 'Turned off in the file ("disabled": true)';
  return server.message ?? (server.state === 'error' ? 'It stopped.' : 'Off');
}

/**
 * Desktop app: tool servers (MCP) give models more tools, such as a calendar, GitHub or a database. They are added only
 * in a file of the person's own; turning one on shows what it runs in the desktop app's own dialog, and each tool call
 * is asked about in the approval window. The page sees names, states and tools, never what a server runs.
 */
export function ToolServers() {
  const [state, setState] = useState<ToolServersState | null>(null);
  useEffect(() => {
    const servers = bridge();
    if (!servers) return;
    void servers.state().then(result => setState(unwrap(result))).catch(() => {});
    return servers.onEvent(setState);
  }, []);
  const run = async (task: () => Promise<NativeResult<ToolServersState>>) => {
    try {
      setState(unwrap(await task()));
    } catch (error) {
      toast(error instanceof NativeError ? error.message : 'That didn’t work.');
    }
  };
  const servers = bridge();
  if (!servers || !state) return null;
  return (
    <div className="storage-box">
      <p>Tool servers (MCP) give models more tools, such as your calendar, GitHub or a database. Add them to Quo’s tool servers file, in the same form other apps use. Turning one on shows exactly what it runs, and Quo asks before each of its tools is used. What a tool returns goes to the chat’s model.</p>
      {state.problem && <p className="note tool-server-problem">{state.problem}</p>}
      {state.servers.length === 0
        ? (
          <>
            <p className="note">None yet. An entry looks like this:</p>
            <pre className="fp-code tool-server-example">{EXAMPLE}</pre>
          </>
        )
        : (
          <div className="toggle-list">
            {state.servers.map(server => (server.state === 'problem' || server.state === 'disabled'
              ? (
                <div className="own-row" key={server.name}>
                  <span className="grow"><span className="title">{server.name}</span><span className="sub">{stateText(server)}</span></span>
                </div>
              )
              : <Toggle key={server.name} label={server.name} detail={stateText(server)} on={server.state === 'on' || server.state === 'starting'} onChange={on => void run(() => servers.set(server.name, on))} />))}
          </div>
        )}
      <div className="model-actions tool-server-actions">
        <button type="button" className="btn btn-glass press small" onClick={() => void servers.edit().catch(() => toast('The file couldn’t be opened.'))}><FileCog size={14} /> Edit the file</button>
        <button type="button" className="btn btn-ghost press small" onClick={() => void run(() => servers.reload())}><RefreshCw size={14} /> Reload</button>
      </div>
    </div>
  );
}
