import { clientIp } from './http';
import { sessionUserId } from './session';

/** Who is calling: a signed-in user, an anonymous device, and an IP. */
export interface Identity {
  userId: string | null;
  deviceId: string;
  ip: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function identify(request: Request): Identity {
  const device = request.headers.get('x-quo-device') ?? '';
  return {
    userId: sessionUserId(request),
    deviceId: UUID.test(device) ? device.toLowerCase() : 'unknown',
    ip: clientIp(request),
  };
}

export function freeSubject(identity: Identity): string {
  return identity.userId ? `user:${identity.userId}` : `device:${identity.deviceId}`;
}
