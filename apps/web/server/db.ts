import { config } from './env';
import { migrate } from './schema';

/**
 * Minimal database interface over Postgres. Production uses postgres.js with
 * DATABASE_URL; the sandbox and tests use embedded PGlite (real Postgres
 * compiled to WebAssembly), so the same SQL runs everywhere.
 *
 * Integer columns only (credits are stored as integer millicredits), so both
 * drivers return plain numbers.
 */
export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Runs `fn` in a transaction; nested calls reuse the outer transaction. */
  tx<T>(fn: (db: Db) => Promise<T>): Promise<T>;
}

let dbPromise: Promise<Db> | null = null;

export function getDb(): Promise<Db> {
  dbPromise ??= open().catch(error => {
    dbPromise = null;
    throw error;
  });
  return dbPromise;
}

/** For tests: a fresh in-memory database. */
export async function createTestDb(): Promise<Db> {
  const db = await openPglite(null);
  await migrate(db);
  return db;
}

async function open(): Promise<Db> {
  const db = config.databaseUrl ? await openPostgres(config.databaseUrl) : await openPglite(config.pgliteDir);
  await migrate(db);
  return db;
}

async function openPostgres(url: string): Promise<Db> {
  const { default: postgres } = await import('postgres');
  const sql = postgres(url, { max: 5, idle_timeout: 20 });
  type Runner = { unsafe: (query: string, params?: never[]) => Promise<unknown> };
  const wrap = (runner: Runner, inTx: boolean): Db => ({
    query: async <T,>(query: string, params: unknown[] = []) => (await runner.unsafe(query, params as never[])) as T[],
    tx: fn => (inTx ? fn(wrap(runner, true)) : sql.begin(t => fn(wrap(t as unknown as Runner, true))) as Promise<never>),
  });
  return wrap(sql as unknown as Runner, false);
}

async function openPglite(dir: string | null): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite');
  const pg = dir ? await PGlite.create(dir) : await PGlite.create();
  type Runner = { query: <T>(query: string, params?: unknown[]) => Promise<{ rows: T[] }> };
  const wrap = (runner: Runner, inTx: boolean): Db => ({
    query: async <T,>(query: string, params: unknown[] = []) => (await runner.query<T>(query, params)).rows,
    tx: fn => (inTx ? fn(wrap(runner, true)) : pg.transaction(t => fn(wrap(t as unknown as Runner, true)))),
  });
  return wrap(pg as unknown as Runner, false);
}
