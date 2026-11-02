import type { Db } from './db.js';

/**
 * Daily totals of Quo's cloud requests: how many, what they cost Quo (OpenRouter's figures, in USD) and what was charged
 * in credits (millicredits). Totals only, never who made a request. `people:free` counts the devices or accounts that
 * used the free model that day. scripts/stats.ts reads them.
 */
export type CostKind = 'chat:free' | 'chat:paid' | 'code:free' | 'image:free' | 'image:paid' | 'people:free';

const day = (now: Date) => now.toISOString().slice(0, 10);

export async function recordCost(db: Db, kind: CostKind, { usd = 0, charged = 0, requests = 1, now = new Date() } = {}): Promise<void> {
  await db.query(
    `insert into daily_costs (day, kind, requests, usd, charged) values ($1, $2, $3, $4, $5)
     on conflict (day, kind) do update set requests = daily_costs.requests + excluded.requests,
       usd = daily_costs.usd + excluded.usd, charged = daily_costs.charged + excluded.charged`,
    [day(now), kind, requests, usd, charged],
  );
}

/** Records without ever failing the request it belongs to. */
export function noteCost(db: Db, kind: CostKind, values: Parameters<typeof recordCost>[2] = {}): Promise<void> {
  return recordCost(db, kind, values).catch(error => console.error('[costs]', error instanceof Error ? error.message : error));
}
