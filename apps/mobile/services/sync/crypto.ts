import { gcm } from '@noble/ciphers/aes';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha2';
import { getRandomBytes } from 'expo-crypto';
import { gunzipSync, gzipSync, strFromU8, strToU8 } from 'fflate';
import { UndecryptableError, type Codec } from './engine';
import { formatRecoveryKey, parseRecoveryKey, SECRET_BYTES } from './recovery';

/**
 * Quo Sync's encryption on the phone: the same format as the web and desktop
 * apps (apps/web/src/sync/crypto.ts, documented in apps/web/SYNC.md), built from
 * audited pure-JavaScript parts because the phone's JavaScript has no WebCrypto.
 * __tests__/vectors.json holds records both implementations must read.
 *
 *   key      HKDF-SHA-256(recovery key, salt "quo-sync/v1", info "record-key") → 32 bytes
 *   record   JSON → gzip → AES-256-GCM, random 96-bit IV, kind and id authenticated
 *   blob     base64( 0x01 | iv(12) | ciphertext + tag )
 */

const VERSION = 1;
const SALT = strToU8('quo-sync/v1');
const KEY_INFO = strToU8('record-key');
const VERIFIER_PHRASE = 'quo-sync: this recovery key is right';

export class SyncCryptoError extends Error {
  constructor(public code: 'bad_key' | 'bad_blob' | 'wrong_key') {
    super(code);
  }
}

export { formatRecoveryKey, parseRecoveryKey };

/** A new random recovery key and its text form. */
export function newRecoveryKey(): { secret: Uint8Array; text: string } {
  const secret = getRandomBytes(SECRET_BYTES);
  return { secret, text: formatRecoveryKey(secret) };
}

/** The key a device keeps, derived from the recovery key. */
export function deriveKey(secret: Uint8Array): Uint8Array {
  if (secret.length !== SECRET_BYTES) throw new SyncCryptoError('bad_key');
  return hkdf(sha256, secret, SALT, KEY_INFO, 32);
}

export const keyToHex = (key: Uint8Array): string => Array.from(key, byte => byte.toString(16).padStart(2, '0')).join('');

export function keyFromHex(hex: string): Uint8Array {
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new SyncCryptoError('bad_key');
  return Uint8Array.from(hex.match(/../g)!, pair => Number.parseInt(pair, 16));
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const context = (kind: string, id: string) => strToU8(`quo-sync/v${VERSION}|${kind}|${id}`);

function seal(key: Uint8Array, plain: Uint8Array, aad: Uint8Array): string {
  const iv = getRandomBytes(12);
  const sealed = gcm(key, iv, aad).encrypt(plain);
  const out = new Uint8Array(1 + iv.length + sealed.length);
  out[0] = VERSION;
  out.set(iv, 1);
  out.set(sealed, 1 + iv.length);
  return toBase64(out);
}

function open(key: Uint8Array, blob: string, aad: Uint8Array): Uint8Array {
  let bytes: Uint8Array;
  try {
    bytes = fromBase64(blob);
  } catch {
    throw new SyncCryptoError('bad_blob');
  }
  if (bytes.length < 1 + 12 + 16 || bytes[0] !== VERSION) throw new SyncCryptoError('bad_blob');
  try {
    return gcm(key, bytes.subarray(1, 13), aad).decrypt(bytes.subarray(13));
  } catch {
    // Wrong key, damaged data, or a record moved to a different id.
    throw new SyncCryptoError('wrong_key');
  }
}

export function encryptRecord(key: Uint8Array, kind: string, id: string, value: unknown): string {
  return seal(key, gzipSync(strToU8(JSON.stringify(value))), context(kind, id));
}

export function decryptRecord(key: Uint8Array, kind: string, id: string, blob: string): unknown {
  return JSON.parse(strFromU8(gunzipSync(open(key, blob, context(kind, id)))));
}

/** Proof that a recovery key is the right one, stored with the account. */
export const makeVerifier = (key: Uint8Array): string => seal(key, strToU8(VERIFIER_PHRASE), context('verifier', 'account'));

export function checkVerifier(key: Uint8Array, verifier: string): boolean {
  try {
    return strFromU8(open(key, verifier, context('verifier', 'account'))) === VERIFIER_PHRASE;
  } catch {
    return false;
  }
}

/** The sync engine's view of the encryption above. */
export function mobileCodec(key: Uint8Array): Codec {
  return {
    encrypt: async (kind, recordId, value) => encryptRecord(key, kind, recordId, value),
    decrypt: async (kind, recordId, blob) => {
      try {
        return decryptRecord(key, kind, recordId, blob);
      } catch (error) {
        if (error instanceof SyncCryptoError) throw new UndecryptableError(error.code);
        throw error;
      }
    },
    verify: async verifier => checkVerifier(key, verifier),
  };
}
