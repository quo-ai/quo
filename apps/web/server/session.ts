import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from './env';
import { cookies } from './http';

/**
 * Sessions are stateless signed tokens in an HttpOnly cookie:
 * base64url(userId.expiry).signature (HMAC-SHA256 with SESSION_SECRET).
 */

const COOKIE = 'quo_session';
const MAX_AGE_S = 180 * 24 * 60 * 60;

const sign = (payload: string) => createHmac('sha256', config.sessionSecret).update(payload).digest('base64url');

export function createSessionCookie(userId: string, now = Date.now()): string {
  const payload = Buffer.from(`${userId}.${now + MAX_AGE_S * 1000}`).toString('base64url');
  const token = `${payload}.${sign(payload)}`;
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_S}${config.production ? '; Secure' : ''}`;
}

export function clearSessionCookie(): string {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${config.production ? '; Secure' : ''}`;
}

export function sessionUserId(request: Request, now = Date.now()): string | null {
  const token = cookies(request)[COOKIE];
  if (!token) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const [userId, expiry] = Buffer.from(payload, 'base64url').toString().split('.');
  if (!userId || !(Number(expiry) > now)) return null;
  return userId;
}
