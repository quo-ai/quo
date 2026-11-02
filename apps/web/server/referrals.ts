import { randomInt } from 'node:crypto';
import { grantCredits, MILLI } from './credits.js';
import { getDb, type Db } from './db.js';
import { config, features, SETUP_MESSAGES } from './env.js';
import { HttpError, json } from './http.js';
import { identify } from './identity.js';

/**
 * Invite a friend. Someone who signs up through a person's link gets NEW_ACCOUNT_CREDITS on top of the trial, but only
 * when both the account and the email address are new (an address that had the trial before gets nothing). The person
 * who invited them gets INVITER_CREDITS when the new account first buys something (a pack or a plan), for up to
 * MAX_REWARDS friends. That reward is tied to the payment (its ref starts txn:<id>:), so a refund takes it back.
 * Who invited whom is kept until either account is deleted (account.ts deletes both tables).
 */
export const NEW_ACCOUNT_CREDITS = 25;
export const INVITER_CREDITS = 50;
export const MAX_REWARDS = 20;
const CREDIT_MONTHS = 12;
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // no 0/o, 1/l/i
export const CODE_PATTERN = /^[a-hjkmnp-z2-9]{8}$/;

const inMonths = (months: number, now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + months, now.getUTCDate()));

/** The person's invite code, made the first time it is asked for. */
export async function referralCode(db: Db, userId: string): Promise<string> {
  const [existing] = await db.query<{ code: string }>('select code from referral_codes where user_id = $1', [userId]);
  if (existing) return existing.code;
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
    const [made] = await db.query<{ code: string }>(
      'insert into referral_codes (user_id, code) values ($1, $2) on conflict do nothing returning code', [userId, code]);
    if (made) return made.code;
    const [raced] = await db.query<{ code: string }>('select code from referral_codes where user_id = $1', [userId]);
    if (raced) return raced.code;
  }
  throw new Error('Could not make an invite code');
}

/** At sign-up: links a new account to the person whose code it came with, and gives the new account its credits. */
export async function claimReferral(db: Db, newUserId: string, code: unknown, now = new Date()): Promise<boolean> {
  if (typeof code !== 'string' || !CODE_PATTERN.test(code)) return false;
  const [inviter] = await db.query<{ user_id: string }>('select user_id from referral_codes where code = $1', [code]);
  if (!inviter || inviter.user_id === newUserId) return false;
  const linked = await db.query('insert into referrals (referred_user_id, referrer_user_id) values ($1, $2) on conflict do nothing returning referred_user_id', [newUserId, inviter.user_id]);
  if (linked.length === 0) return false;
  await grantCredits(db, newUserId, 'referral', NEW_ACCOUNT_CREDITS * MILLI, inMonths(CREDIT_MONTHS, now), `referral:${newUserId}:welcome`);
  return true;
}

/** After a completed payment: the first one from an invited account rewards whoever invited it, up to MAX_REWARDS. */
export async function rewardReferrer(db: Db, buyerId: string, transactionId: string, now = new Date()): Promise<boolean> {
  const [link] = await db.query<{ referrer_user_id: string }>(
    'select referrer_user_id from referrals where referred_user_id = $1 and rewarded_at is null for update', [buyerId]);
  if (!link) return false;
  const [{ n }] = await db.query<{ n: number }>('select count(*)::int as n from referrals where referrer_user_id = $1 and rewarded_at is not null', [link.referrer_user_id]);
  await db.query('update referrals set rewarded_at = $2 where referred_user_id = $1', [buyerId, now]);
  if (n >= MAX_REWARDS) return false;
  return grantCredits(db, link.referrer_user_id, 'referral', INVITER_CREDITS * MILLI, inMonths(CREDIT_MONTHS, now), `txn:${transactionId}:referral`);
}

/** GET /api/referral: the person's invite link and how many friends have earned them credits. */
export async function handleReferral(request: Request): Promise<Response> {
  if (!features.accounts) throw new HttpError(503, 'setup_required', SETUP_MESSAGES.accounts);
  const db = await getDb();
  const { userId } = await identify(db, request);
  if (!userId) throw new HttpError(401, 'sign_in_required', 'Sign in first.');
  const code = await referralCode(db, userId);
  const [{ rewarded }] = await db.query<{ rewarded: number }>('select count(*)::int as rewarded from referrals where referrer_user_id = $1 and rewarded_at is not null', [userId]);
  return json({ code, link: `${config.appUrl}/?ref=${code}`, rewarded: Math.min(rewarded, MAX_REWARDS), max: MAX_REWARDS, forFriend: NEW_ACCOUNT_CREDITS, forYou: INVITER_CREDITS });
}
