import { PRODUCTS, type ProductId } from './billing.js';
import { MILLI } from './credits.js';
import type { Db } from './db.js';

/**
 * The figures that say whether Quo's prices and free limits work, for the last `days` days (scripts/stats.ts prints
 * them). Costs come from the daily totals (costs.ts); sales, plans and credits from the account tables. Nothing here
 * names a person.
 */
export interface Stats {
  days: number;
  free: { personDays: number; requests: number; usd: number; usdPerPersonDay: number | null; chatUsd: number; codeUsd: number; images: number; imageUsd: number };
  paid: { requests: number; usd: number; credits: number };
  sales: { packs: Partial<Record<ProductId, number>>; newPlans: Partial<Record<ProductId, number>>; activePlans: Partial<Record<ProductId, number>>; newSalesUsd: number };
  /** Pro's monthly credits whose month ended in the period: how much of them was used. */
  allowance: { months: number; usedShare: number | null };
  accounts: { total: number; new: number; paying: number; conversion: number | null };
  /** Trials whose 90 days ended in the period: how much of the 25 credits was used. */
  trial: { given: number; ended: number; usedShare: number | null };
}

const ACTIVE = ['active', 'trialing', 'past_due'];
const priceOf = (id: ProductId) => Number(PRODUCTS[id].price.replace(/[^0-9.]/g, ''));
const share = (used: number, total: number) => (total > 0 ? used / total : null);

export async function collectStats(db: Db, days = 30, now = new Date()): Promise<Stats> {
  const since = new Date(now.getTime() - days * 86_400_000);
  const totals = await db.query<{ kind: string; requests: number; usd: number; charged: number }>(
    `select kind, sum(requests)::int as requests, sum(usd)::float8 as usd, sum(charged)::float8 as charged
     from daily_costs where day > $1::date group by kind`,
    [since.toISOString().slice(0, 10)],
  );
  const of = (kind: string) => totals.find(row => row.kind === kind) ?? { requests: 0, usd: 0, charged: 0 };
  const freeKinds = ['chat:free', 'code:free', 'image:free'].map(of);
  const freeUsd = freeKinds.reduce((sum, row) => sum + row.usd, 0);
  const personDays = of('people:free').requests;
  const paidKinds = ['chat:paid', 'image:paid'].map(of);

  const packs: Stats['sales']['packs'] = {};
  for (const row of await db.query<{ ref: string }>(`select ref from credit_grants where kind = 'pack' and created_at >= $1`, [since])) {
    const id = row.ref.split(':').pop() as ProductId;
    if (id in PRODUCTS) packs[id] = (packs[id] ?? 0) + 1;
  }
  const count = (rows: { plan: string; n: number }[]) => Object.fromEntries(rows.filter(row => row.plan in PRODUCTS).map(row => [row.plan, row.n]));
  const newPlans = count(await db.query(`select plan, count(*)::int as n from subscriptions where started_at >= $1 group by plan`, [since]));
  const activePlans = count(await db.query(`select plan, count(*)::int as n from subscriptions where status = any($1) group by plan`, [ACTIVE]));
  const newSalesUsd = [...Object.entries(packs), ...Object.entries(newPlans)].reduce((sum, [id, n]) => sum + priceOf(id as ProductId) * (n ?? 0), 0);

  const [monthly] = await db.query<{ n: number; amount: number; remaining: number }>(
    `select count(*)::int as n, coalesce(sum(amount), 0)::float8 as amount, coalesce(sum(remaining), 0)::float8 as remaining
     from credit_grants where kind = 'monthly' and expires_at > $1 and expires_at <= $2`, [since, now]);
  const [accounts] = await db.query<{ total: number; fresh: number; paying: number }>(
    `select (select count(*)::int from users) as total,
            (select count(*)::int from users where created_at >= $1) as fresh,
            (select count(distinct user_id)::int from (select user_id from credit_grants where kind in ('pack', 'monthly')
               union select user_id from subscriptions) paid) as paying`, [since]);
  const [trial] = await db.query<{ given: number; ended: number; amount: number; remaining: number }>(
    `select (select count(*)::int from credit_grants where kind = 'trial' and created_at >= $1) as given,
            count(*)::int as ended, coalesce(sum(amount), 0)::float8 as amount, coalesce(sum(remaining), 0)::float8 as remaining
     from credit_grants where kind = 'trial' and expires_at > $1 and expires_at <= $2`, [since, now]);

  return {
    days,
    free: {
      personDays,
      requests: freeKinds.reduce((sum, row) => sum + row.requests, 0),
      usd: freeUsd,
      usdPerPersonDay: personDays > 0 ? freeUsd / personDays : null,
      chatUsd: of('chat:free').usd,
      codeUsd: of('code:free').usd,
      images: of('image:free').requests,
      imageUsd: of('image:free').usd,
    },
    paid: { requests: paidKinds.reduce((sum, row) => sum + row.requests, 0), usd: paidKinds.reduce((sum, row) => sum + row.usd, 0), credits: paidKinds.reduce((sum, row) => sum + row.charged, 0) / MILLI },
    sales: { packs, newPlans, activePlans, newSalesUsd },
    allowance: { months: monthly.n, usedShare: share(monthly.amount - monthly.remaining, monthly.amount) },
    accounts: { total: accounts.total, new: accounts.fresh, paying: accounts.paying, conversion: share(accounts.paying, accounts.total) },
    trial: { given: trial.given, ended: trial.ended, usedShare: share(trial.amount - trial.remaining, trial.amount) },
  };
}
