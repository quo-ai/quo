import { createHash, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { grantTrial } from './credits.js';
import { getDb } from './db.js';
import { sendLoginCode } from './email.js';
import { config, features, SETUP_MESSAGES } from './env.js';
import { takeFreeMessage } from './freeTier.js';
import { HttpError, json, readJson } from './http.js';
import { anonymous, identify } from './identity.js';
import { accountSummary } from './account.js';
import { clearSessionCookie, createSessionCookie, createSessionToken } from './session.js';

/**
 * Passwordless sign-in with a 6-digit code sent by email. Codes expire after
 * 10 minutes and allow 5 attempts; requests are rate-limited per email and
 * per IP. New accounts get one-time trial credits.
 */

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const hashCode = (email: string, code: string) =>
  createHash('sha256').update(`${config.sessionSecret}:${email}:${code}`).digest('hex');

function normalizeEmail(value: unknown): string {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!EMAIL.test(email) || email.length > 254) throw new HttpError(400, 'bad_email', 'Enter a valid email address.');
  return email;
}

export async function handleAuthStart(request: Request): Promise<Response> {
  if (!features.accounts) throw new HttpError(503, 'setup_required', SETUP_MESSAGES.accounts);
  const body = await readJson<{ email?: string }>(request);
  const email = normalizeEmail(body.email);
  const db = await getDb();
  const allowed = await takeFreeMessage(db, { subject: `login:${email}`, ip: `login:${anonymous(request).ip}` }, { perSubject: 8, perIp: 30 });
  if (!allowed) throw new HttpError(429, 'too_many_codes', 'Too many codes requested. Try again tomorrow.');

  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await db.query(
    `insert into login_codes (email, code_hash, expires_at, attempts) values ($1, $2, $3, 0)
     on conflict (email) do update set code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0`,
    [email, hashCode(email, code), new Date(Date.now() + CODE_TTL_MS)],
  );
  await sendLoginCode(email, code);
  // Sandbox only (no email service): hand the code back so testing needs no inbox.
  return json({ ok: true, ...(!config.production && !config.resendKey ? { devCode: code } : {}) });
}

export async function handleAuthVerify(request: Request): Promise<Response> {
  if (!features.accounts) throw new HttpError(503, 'setup_required', SETUP_MESSAGES.accounts);
  const body = await readJson<{ email?: string; code?: string; client?: string }>(request);
  const email = normalizeEmail(body.email);
  const code = String(body.code ?? '').replace(/\D/g, '');
  const db = await getDb();

  const [row] = await db.query<{ code_hash: string; expires_at: Date; attempts: number }>(
    'select code_hash, expires_at, attempts from login_codes where email = $1', [email],
  );
  if (!row || new Date(row.expires_at) < new Date()) throw new HttpError(400, 'code_expired', 'That code has expired. Request a new one.');
  if (row.attempts >= MAX_ATTEMPTS) throw new HttpError(429, 'too_many_attempts', 'Too many attempts. Request a new code.');
  const expected = Buffer.from(row.code_hash);
  const given = Buffer.from(hashCode(email, code));
  if (code.length !== 6 || !timingSafeEqual(expected, given)) {
    await db.query('update login_codes set attempts = attempts + 1 where email = $1', [email]);
    throw new HttpError(400, 'wrong_code', 'That code isn’t right. Check it and try again.');
  }

  await db.query('delete from login_codes where email = $1', [email]);
  await db.query('insert into users (id, email) values ($1, $2) on conflict (email) do nothing', [randomUUID(), email]);
  const [user] = await db.query<{ id: string }>('select id from users where email = $1', [email]);
  await grantTrial(db, user.id);

  const summary = await accountSummary(db, { ...anonymous(request), userId: user.id });
  // The phone app has no cookie jar to rely on: it asks for the token itself and keeps it in secure storage.
  if (body.client === 'app') return json({ ...summary, token: createSessionToken(user.id) });
  return json(summary, 200, { 'set-cookie': createSessionCookie(user.id) });
}

export function handleSignOut(): Response {
  return json({ ok: true }, 200, { 'set-cookie': clearSessionCookie() });
}

/**
 * "Sign out everywhere": every session started before now stops working (a lost
 * phone, a shared computer). The caller stays signed in, with a fresh session.
 * Tokens are stateless, so this is a marker on the account, not a list.
 */
export async function handleSignOutEverywhere(request: Request): Promise<Response> {
  const db = await getDb();
  const { userId } = await identify(db, request);
  if (!userId) throw new HttpError(401, 'sign_in_required', 'Sign in first.');
  const body = await readJson<{ client?: string }>(request);
  const now = Date.now();
  await db.query('update users set sessions_valid_after = $2 where id = $1', [userId, now]);
  if (body.client === 'app') return json({ ok: true, token: createSessionToken(userId, now) });
  return json({ ok: true }, 200, { 'set-cookie': createSessionCookie(userId, now) });
}
