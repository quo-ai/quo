/**
 * Quo Sync's cryptography. Everything the server stores is encrypted here, on
 * the device, with a key the server never sees.
 *
 *   recovery key   160 random bits, shown to the user once as 8 groups of 4
 *                  letters/digits (+ 2 check characters that catch typos)
 *   record key     HKDF-SHA-256(recovery key) → AES-256-GCM, non-extractable;
 *                  this, not the recovery key, is what a device keeps
 *   a record       JSON → gzip → AES-GCM with a fresh random 96-bit IV; the
 *                  record's kind and id are authenticated, so the server can't
 *                  hand one record's ciphertext back as another's
 *   blob           base64( 0x01 | iv(12) | ciphertext+tag )
 *
 * The recovery key is random, not a password, so it needs no slow key
 * stretching. The format is versioned (the leading byte) so it can change.
 */

import { UndecryptableError, type Codec } from './engine';
import { formatRecoveryKey, parseRecoveryKey, SECRET_BYTES } from './recovery';

const VERSION = 1;
const SALT = new TextEncoder().encode('quo-sync/v1');
const KEY_INFO = new TextEncoder().encode('record-key');
const VERIFIER_PHRASE = 'quo-sync: this recovery key is right';

export class SyncCryptoError extends Error {
  constructor(public code: 'bad_key' | 'bad_blob' | 'wrong_key') {
    super(code);
  }
}


// ---------- recovery key (recovery.ts) ----------

export { formatRecoveryKey, parseRecoveryKey };

export function generateSecret(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(SECRET_BYTES));
}

/** A new random recovery key and its text form. */
export function newRecoveryKey(): { secret: Uint8Array; text: string } {
  const secret = generateSecret();
  return { secret, text: formatRecoveryKey(secret) };
}


/** The key a device keeps: derived from the recovery key and unable to be exported again. */
export async function deriveKey(secret: Uint8Array): Promise<CryptoKey> {
  if (secret.length !== SECRET_BYTES) throw new SyncCryptoError('bad_key');
  const base = await crypto.subtle.importKey('raw', secret as BufferSource, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: SALT, info: KEY_INFO },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

// ---------- bytes <-> base64, gzip ----------

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

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const writer = stream.writable.getWriter();
  void writer.write(bytes as BufferSource).then(() => writer.close());
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}

const gzip = (bytes: Uint8Array) => pipe(bytes, new CompressionStream('gzip'));
const gunzip = (bytes: Uint8Array) => pipe(bytes, new DecompressionStream('gzip'));

// ---------- records ----------

const aad = (kind: string, id: string) => new TextEncoder().encode(`quo-sync/v${VERSION}|${kind}|${id}`);

async function seal(key: CryptoKey, plain: Uint8Array, context: Uint8Array): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: context as BufferSource }, key, plain as BufferSource));
  const out = new Uint8Array(1 + iv.length + sealed.length);
  out[0] = VERSION;
  out.set(iv, 1);
  out.set(sealed, 1 + iv.length);
  return toBase64(out);
}

async function open(key: CryptoKey, blob: string, context: Uint8Array): Promise<Uint8Array> {
  let bytes: Uint8Array;
  try {
    bytes = fromBase64(blob);
  } catch {
    throw new SyncCryptoError('bad_blob');
  }
  if (bytes.length < 1 + 12 + 16 || bytes[0] !== VERSION) throw new SyncCryptoError('bad_blob');
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(1, 13) as BufferSource, additionalData: context as BufferSource }, key, bytes.subarray(13) as BufferSource));
  } catch {
    // Wrong key, damaged data, or a record moved to a different id.
    throw new SyncCryptoError('wrong_key');
  }
}

export async function encryptRecord(key: CryptoKey, kind: string, id: string, value: unknown): Promise<string> {
  const plain = await gzip(new TextEncoder().encode(JSON.stringify(value)));
  return seal(key, plain, aad(kind, id));
}

export async function decryptRecord<T>(key: CryptoKey, kind: string, id: string, blob: string): Promise<T> {
  const plain = await gunzip(await open(key, blob, aad(kind, id)));
  return JSON.parse(new TextDecoder().decode(plain)) as T;
}

/** Proof that a recovery key is the right one, stored with the account: lets a new device check before downloading anything. */
export function makeVerifier(key: CryptoKey): Promise<string> {
  return seal(key, new TextEncoder().encode(VERIFIER_PHRASE), aad('verifier', 'account'));
}

export async function checkVerifier(key: CryptoKey, verifier: string): Promise<boolean> {
  try {
    return new TextDecoder().decode(await open(key, verifier, aad('verifier', 'account'))) === VERIFIER_PHRASE;
  } catch {
    return false;
  }
}

/** The sync engine's view of the encryption above. */
export function webCodec(key: CryptoKey): Codec {
  return {
    encrypt: (kind, recordId, value) => encryptRecord(key, kind, recordId, value),
    decrypt: async (kind, recordId, blob) => {
      try {
        return await decryptRecord(key, kind, recordId, blob);
      } catch (error) {
        if (error instanceof SyncCryptoError) throw new UndecryptableError(error.code);
        throw error;
      }
    },
    verify: verifier => checkVerifier(key, verifier),
  };
}
