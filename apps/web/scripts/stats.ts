// Prints the figures that show whether Quo's prices and free limits work (server/stats.ts), for the last N days.
// On the server, where the database settings are:  node --env-file=C:\quo\config\quo.env --import tsx scripts/stats.ts [days]
import { getDb } from '../server/db.js';
import { collectStats } from '../server/stats.js';

const days = Number(process.argv[2] ?? 30);
if (!Number.isInteger(days) || days < 1) throw new Error('Give the number of days, for example 30.');
const s = await collectStats(await getDb(), days);
// Costs can be fractions of a cent: enough decimals to see them. Sales are whole money.
const usd = (n: number) => `$${n === 0 ? '0' : n.toFixed(n < 0.01 ? 6 : n < 1 ? 4 : 2)}`;
const money = (n: number) => `$${n.toFixed(2)}`;
const pct = (n: number | null) => (n === null ? 'not yet' : `${Math.round(n * 100)}%`);
const list = (counts: Record<string, number | undefined>) => Object.entries(counts).map(([id, n]) => `${id} ${n}`).join(', ') || 'none';

console.log(`Quo, last ${days === 1 ? 'day' : `${days} days`}
Free cloud use (costs Quo)
  people a day, added up    ${s.free.personDays}
  requests                  ${s.free.requests}: chat ${usd(s.free.chatUsd)}, Code mode ${usd(s.free.codeUsd)}, ${s.free.images} images ${usd(s.free.imageUsd)}
  total cost                ${usd(s.free.usd)}
  cost per person a day     ${s.free.usdPerPersonDay === null ? 'not yet' : usd(s.free.usdPerPersonDay)}
Paid cloud use
  requests                  ${s.paid.requests}, cost ${usd(s.paid.usd)}, ${s.paid.credits.toFixed(1)} credits charged
Sales
  credit packs              ${list(s.sales.packs)}
  new plans                 ${list(s.sales.newPlans)}
  plans running now         ${list(s.sales.activePlans)}
  new sales (list prices)   ${money(s.sales.newSalesUsd)} before tax and Stripe's fees (renewals not counted)
Pro allowance used          ${pct(s.allowance.usedShare)} of ${s.allowance.months} finished months
Trial                       ${s.trial.given} given; ${pct(s.trial.usedShare)} used of ${s.trial.ended} that ended
Accounts                    ${s.accounts.total} in all, ${s.accounts.new} new, ${s.accounts.paying} have paid (${pct(s.accounts.conversion)})`);
process.exit(0);
