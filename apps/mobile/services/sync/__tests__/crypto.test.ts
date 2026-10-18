import { randomBytes } from 'crypto';
import vectors from './vectors.json';
import {
  checkVerifier, decryptRecord, deriveKey, encryptRecord, formatRecoveryKey, keyFromHex, keyToHex, makeVerifier, mobileCodec, newRecoveryKey, parseRecoveryKey, SyncCryptoError,
} from '../crypto';
import { UndecryptableError } from '../engine';

const secret = Uint8Array.from(Buffer.from(vectors.secretHex, 'hex'));

describe('the shared test vectors (written by both apps)', () => {
  it('format and read the recovery key the same way', () => {
    expect(formatRecoveryKey(secret)).toBe(vectors.recoveryKey);
    expect(Array.from(parseRecoveryKey(vectors.recoveryKey)!)).toEqual(Array.from(secret));
  });

  it('decrypt every record, whichever platform wrote it', () => {
    const key = deriveKey(secret);
    for (const record of vectors.records) {
      expect(decryptRecord(key, record.kind, record.id, record.blob)).toEqual(record.value);
    }
  });

  it('accept both platforms’ verifiers', () => {
    const key = deriveKey(secret);
    expect(checkVerifier(key, vectors.verifier)).toBe(true);
    expect(checkVerifier(key, vectors.mobileVerifier)).toBe(true);
  });
});

describe('records', () => {
  const chat = { id: 'c1', title: 'Hi', messages: [{ id: 'm', role: 'user', content: 'ünïcode 🚀 and a secret plan' }] };

  it('round-trip', () => {
    const key = deriveKey(newRecoveryKey().secret);
    expect(decryptRecord(key, 'chat', 'rec-1', encryptRecord(key, 'chat', 'rec-1', chat))).toEqual(chat);
  });

  it('are valid base64 that the server accepts, and reveal nothing readable', () => {
    const key = deriveKey(newRecoveryKey().secret);
    const blob = encryptRecord(key, 'chat', 'rec-1', chat);
    expect(blob).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    expect(Buffer.from(blob, 'base64').toString('latin1')).not.toContain('secret plan');
  });

  it('are different every time, even for the same content', () => {
    const key = deriveKey(newRecoveryKey().secret);
    expect(encryptRecord(key, 'chat', 'rec-1', chat)).not.toBe(encryptRecord(key, 'chat', 'rec-1', chat));
  });

  it('compress long chats', () => {
    const key = deriveKey(newRecoveryKey().secret);
    const long = { text: 'the quick brown fox jumps over the lazy dog. '.repeat(2000) };
    const blob = encryptRecord(key, 'chat', 'r', long);
    expect(blob.length).toBeLessThan(JSON.stringify(long).length / 20);
    expect(decryptRecord(key, 'chat', 'r', blob)).toEqual(long);
  });

  it('cannot be opened with another key, or moved to another record or kind', () => {
    const key = deriveKey(newRecoveryKey().secret);
    const blob = encryptRecord(key, 'chat', 'rec-1', chat);
    expect(() => decryptRecord(deriveKey(newRecoveryKey().secret), 'chat', 'rec-1', blob)).toThrow(SyncCryptoError);
    expect(() => decryptRecord(key, 'chat', 'rec-2', blob)).toThrow(SyncCryptoError);
    expect(() => decryptRecord(key, 'memory', 'rec-1', blob)).toThrow(SyncCryptoError);
  });

  it('notice any tampering', () => {
    const key = deriveKey(newRecoveryKey().secret);
    const bytes = Buffer.from(encryptRecord(key, 'chat', 'rec-1', chat), 'base64');
    for (const index of [0, 5, 20, bytes.length - 1]) {
      const copy = Buffer.from(bytes);
      copy[index] ^= 1;
      expect(() => decryptRecord(key, 'chat', 'rec-1', copy.toString('base64'))).toThrow(SyncCryptoError);
    }
    expect(() => decryptRecord(key, 'chat', 'rec-1', bytes.subarray(0, 10).toString('base64'))).toThrow(SyncCryptoError);
    expect(() => decryptRecord(key, 'chat', 'rec-1', '!!not base64!!')).toThrow(SyncCryptoError);
  });

  it('use a fresh random IV from a secure source for each record', () => {
    const key = deriveKey(newRecoveryKey().secret);
    const ivs = new Set(Array.from({ length: 50 }, () => Buffer.from(encryptRecord(key, 'chat', 'r', chat), 'base64').subarray(1, 13).toString('hex')));
    expect(ivs.size).toBe(50);
  });
});

describe('keys', () => {
  it('derive deterministically, to 32 bytes, from exactly 20', () => {
    expect(deriveKey(secret)).toHaveLength(32);
    expect(Array.from(deriveKey(secret))).toEqual(Array.from(deriveKey(secret)));
    expect(() => deriveKey(randomBytes(19))).toThrow(SyncCryptoError);
  });

  it('survive being stored as hex', () => {
    const key = deriveKey(newRecoveryKey().secret);
    expect(Array.from(keyFromHex(keyToHex(key)))).toEqual(Array.from(key));
    expect(() => keyFromHex('nope')).toThrow(SyncCryptoError);
  });

  it('make recovery keys that read back, forgivingly, and catch typos', () => {
    const { secret: made, text } = newRecoveryKey();
    expect(text).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){8}[0-9A-HJKMNP-TV-Z]{2}$/);
    expect(Array.from(parseRecoveryKey(text.toLowerCase().replace(/-/g, ' '))!)).toEqual(Array.from(made));
    const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    const plain = text.replace(/-/g, '');
    for (let i = 0; i < plain.length; i++) {
      for (const other of alphabet) {
        if (other !== plain[i]) expect(parseRecoveryKey(plain.slice(0, i) + other + plain.slice(i + 1))).toBeNull();
      }
    }
  });

  it('verify only their own recovery key', () => {
    const key = deriveKey(secret);
    const verifier = makeVerifier(key);
    expect(checkVerifier(key, verifier)).toBe(true);
    expect(checkVerifier(deriveKey(newRecoveryKey().secret), verifier)).toBe(false);
    expect(checkVerifier(key, 'garbage')).toBe(false);
  });
});

describe('the engine’s codec', () => {
  it('turns "can’t read this" into the error the engine skips on, and passes other failures through', async () => {
    const codec = mobileCodec(deriveKey(secret));
    const other = mobileCodec(deriveKey(newRecoveryKey().secret));
    const blob = await codec.encrypt('chat', 'c1', { id: 'c1' });
    await expect(other.decrypt('chat', 'c1', blob)).rejects.toBeInstanceOf(UndecryptableError);
    expect(await codec.decrypt('chat', 'c1', blob)).toEqual({ id: 'c1' });
    expect(await codec.verify(vectors.verifier)).toBe(true);
    expect(await other.verify(vectors.verifier)).toBe(false);
  });
});
