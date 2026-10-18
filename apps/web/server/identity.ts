import type { Db } from './db.js';
import { clientIp } from './http.js';
import { readSession } from './session.js';

/** Who is calling: a signed-in user, an anonymous device, and an IP. */
export interface Identity {
  userId: string | null;
  deviceId: string;
  ip: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The device and IP only: for the places that don't care who is signed in. */
export function anonymous(request: Request): Identity {
  const device = request.headers.get('x-quo-device') ?? '';
  return {
    userId: null,
    deviceId: UUID.test(device) ? device.toLowerCase() : 'unknown',
    ip: clientIp(request),
  };
}

/**
 * Who is calling. A session is a signed token that lives until it expires, so
 * it's checked against the database as well: the account must still exist, and
 * the session must have started after the last "sign out everywhere".
 * Signed-out requests cost no query.
 */
export async function identify(db: Db, request: Request): Promise<Identity> {
  const identity = anonymous(request);
  const session = readSession(request);
  if (!session || !UUID.test(session.userId)) return identity;
  const [user] = await db.query<{ valid_after: string | null }>('select sessions_valid_after as valid_after from users where id = $1', [session.userId]);
  if (!user) return identity; // the account was deleted
  if (user.valid_after !== null && session.issuedAt < Number(user.valid_after)) return identity;
  return { ...identity, userId: session.userId };
}

export function freeSubject(identity: Identity): string {
  return identity.userId ? `user:${identity.userId}` : `device:${identity.deviceId}`;
}
