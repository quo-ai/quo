import type { Db } from './db.js';

/**
 * Schema (idempotent). Credits are integer millicredits (1 credit = 1000).
 *
 * credit_grants: every source of credits (monthly Pro allowance, packs,
 * trial) with its own expiry; spending draws from the soonest-expiring
 * first. credit_holds: amounts reserved by in-flight cloud requests.
 * credit_ledger: append-only history of every change.
 * trial_claims: keyed one-way hashes of the email addresses that had the free trial, kept a year (also after an account
 * is deleted) so deleting and signing up again doesn't give a second one.
 * daily_costs: totals per day of cloud requests, their cost and credits charged; nothing about who (costs.ts).
 * referral_codes, referrals: invite codes and who invited whom (referrals.ts), deleted with either account.
 */
const STATEMENTS = [
  `create table if not exists users (
    id uuid primary key,
    email text unique not null,
    paddle_customer_id text,
    created_at timestamptz not null default now()
  )`,
  `create table if not exists login_codes (
    email text primary key,
    code_hash text not null,
    expires_at timestamptz not null,
    attempts integer not null default 0
  )`,
  `create table if not exists subscriptions (
    id text primary key,
    user_id uuid not null references users(id),
    plan text not null,
    status text not null,
    started_at timestamptz not null,
    current_period_end timestamptz,
    updated_at timestamptz not null default now()
  )`,
  `create index if not exists subscriptions_user on subscriptions(user_id)`,
  `create table if not exists credit_grants (
    id uuid primary key,
    user_id uuid not null references users(id),
    kind text not null,
    amount integer not null,
    remaining integer not null,
    expires_at timestamptz not null,
    ref text unique not null,
    created_at timestamptz not null default now()
  )`,
  `create index if not exists credit_grants_user on credit_grants(user_id, expires_at)`,
  `create table if not exists credit_holds (
    id uuid primary key,
    user_id uuid not null references users(id),
    amount integer not null,
    expires_at timestamptz not null
  )`,
  `create index if not exists credit_holds_user on credit_holds(user_id)`,
  `create table if not exists credit_ledger (
    id bigserial primary key,
    user_id uuid not null references users(id),
    delta integer not null,
    reason text not null,
    ref text,
    created_at timestamptz not null default now()
  )`,
  `create table if not exists free_usage (
    key text not null,
    day date not null,
    count integer not null default 0,
    primary key (key, day)
  )`,
  // Free-usage keys are hashed (freeTier.ts); remove any stored before that.
  `delete from free_usage where key like '%:%'`,
  // Quo Sync (sync.ts). The server only ever holds ciphertext: blob is
  // base64 of an AES-GCM message the user's devices encrypted, and verifier
  // lets a new device check a recovery key before it touches any data.
  `create table if not exists sync_accounts (
    user_id uuid primary key references users(id),
    verifier text not null,
    seq integer not null default 0,
    created_at timestamptz not null default now()
  )`,
  `create table if not exists sync_records (
    user_id uuid not null references users(id),
    id text not null,
    kind text not null,
    seq integer not null,
    blob text,
    deleted boolean not null default false,
    size integer not null default 0,
    updated_at timestamptz not null default now(),
    primary key (user_id, id)
  )`,
  `create index if not exists sync_records_seq on sync_records(user_id, seq)`,
  // "Sign out everywhere": sessions issued before this moment (ms since the epoch) no longer work (identity.ts).
  `alter table users add column if not exists sessions_valid_after bigint`,
  // When the "your synced chats will be deleted" email was sent (syncRetention.ts).
  `alter table sync_accounts add column if not exists warned_at timestamptz`,
  `create table if not exists processed_events (
    id text primary key,
    created_at timestamptz not null default now()
  )`,  `create table if not exists trial_claims (
    email_hash text primary key,
    claimed_at timestamptz not null default now()
  )`,  `create table if not exists referral_codes (
    user_id uuid primary key references users(id),
    code text unique not null,
    created_at timestamptz not null default now()
  )`,
  `create table if not exists referrals (
    referred_user_id uuid primary key references users(id),
    referrer_user_id uuid not null references users(id),
    created_at timestamptz not null default now(),
    rewarded_at timestamptz
  )`,
  `create index if not exists referrals_referrer on referrals(referrer_user_id)`,
  `create table if not exists daily_costs (
    day date not null,
    kind text not null,
    requests integer not null default 0,
    usd double precision not null default 0,
    charged integer not null default 0,
    primary key (day, kind)
  )`,
];

export async function migrate(db: Db): Promise<void> {
  for (const statement of STATEMENTS) await db.query(statement);
}
