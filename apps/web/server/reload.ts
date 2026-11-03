import cluster, { type Worker } from 'node:cluster';
import { readFileSync, unwatchFile, watchFile, writeFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

/**
 * Deploys without dropping a request. With QUO_RELOAD_FILE set, serve.ts runs this supervisor: it holds the port and
 * runs the server in a worker process. When the reload file changes (deploys write a new token into it), it starts a
 * worker with the code now on disk; once that one listens, it writes the token to QUO_RELOAD_ACK (so the deploy knows
 * the new code started) and tells the old worker to drain: no new requests, finish the ones it has (a chat stream, an
 * image), then exit, within DRAIN_MS. A new worker that fails to start leaves the old one serving. A worker that dies
 * on its own is replaced. Stopping the service (Ctrl+C) drains every worker the same way before exiting.
 *
 * Each new worker gets the settings file (node's --env-file) as it is now, so a changed or removed setting goes live
 * with a reload too, not only with a restart.
 */
export const DRAIN_MS = 120_000;

const readToken = (file: string) => {
  try {
    return readFileSync(file, 'utf8').trim();
  } catch {
    return '';
  }
};

const readSettings = (file: string): Record<string, string> | null => {
  try {
    return parseEnv(readFileSync(file, 'utf8')) as Record<string, string>;
  } catch {
    return null; // unreadable for a moment: keep the settings the workers have
  }
};

/** Puts the settings file's values into env, removes the ones it no longer has, and returns the keys it now holds. */
export function refreshSettings(env: NodeJS.ProcessEnv, previous: string[], fresh: Record<string, string> | null): string[] {
  if (!fresh) return previous;
  for (const key of previous) if (!(key in fresh)) delete env[key];
  Object.assign(env, fresh);
  return Object.keys(fresh);
}

export function runReloadable(reloadFile: string, ackFile?: string): void {
  let current: Worker | null = null;
  let stopping = false;
  // Workers inherit the supervisor's environment, which node filled from the settings file when the service started.
  const settingsFile = process.execArgv.find(arg => arg.startsWith('--env-file='))?.slice('--env-file='.length);
  let settingsKeys = settingsFile ? Object.keys(readSettings(settingsFile) ?? {}) : [];

  const drain = (worker: Worker) => {
    if (!worker.isConnected()) return;
    worker.send('drain');
    const kill = setTimeout(() => worker.kill(), DRAIN_MS);
    worker.once('exit', () => clearTimeout(kill));
  };

  const start = (token: string) => {
    if (settingsFile && token) settingsKeys = refreshSettings(process.env, settingsKeys, readSettings(settingsFile));
    const worker = cluster.fork();
    let listening = false;
    worker.once('listening', () => {
      listening = true;
      const old = current;
      current = worker;
      if (old) drain(old);
      if (token && ackFile) {
        try {
          writeFileSync(ackFile, token);
        } catch (error) {
          console.error('[reload] couldn’t write the acknowledgement', error);
        }
      }
      console.log(`[reload] worker ${worker.process.pid} serving${token ? ' (new code)' : ''}`);
    });
    worker.on('exit', code => {
      if (!listening) console.error(`[reload] a new worker exited (${code}) before it served: the previous one keeps serving`);
      if (worker === current && !stopping) {
        current = null;
        setTimeout(() => start(''), 1000); // crashed while serving: replace it
      }
    });
  };

  start('');
  watchFile(reloadFile, { interval: 1000 }, (now, before) => {
    if (!stopping && now.mtimeMs !== before.mtimeMs) start(readToken(reloadFile));
  });

  const stop = () => {
    if (stopping) return;
    stopping = true;
    unwatchFile(reloadFile);
    const workers = Object.values(cluster.workers ?? {}).filter((worker): worker is Worker => Boolean(worker));
    if (workers.length === 0) process.exit(0);
    let left = workers.length;
    for (const worker of workers) {
      worker.once('exit', () => --left === 0 && process.exit(0));
      drain(worker);
    }
    setTimeout(() => process.exit(0), DRAIN_MS + 5000).unref();
  };
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGBREAK'] as const) process.on(signal, stop);
}
