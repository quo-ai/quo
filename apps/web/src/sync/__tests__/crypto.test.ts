// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  checkVerifier, decryptRecord, deriveKey, encryptRecord, formatRecoveryKey, makeVerifier, newRecoveryKey, parseRecoveryKey, SyncCryptoError,
} from '../crypto';

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/; // what the server accepts

describe('recovery keys', () => {
  it('look like 8 groups of 4, plus a 2-character check', () => {
    const { text } = newRecoveryKey();
    expect(text).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){8}[0-9A-HJKMNP-TV-Z]{2}$/);
  });

  it('are random, and read back exactly', () => {
    const a = newRecoveryKey();
    const b = newRecoveryKey();
    expect(a.text).not.toBe(b.text);
    expect(parseRecoveryKey(a.text)).toEqual(a.secret);
  });

  it('are forgiving about how they are typed', () => {
    const { secret, text } = newRecoveryKey();
    expect(parseRecoveryKey(text.toLowerCase())).toEqual(secret);
    expect(parseRecoveryKey(text.replace(/-/g, ' '))).toEqual(secret);
    expect(parseRecoveryKey(text.replace(/-/g, ''))).toEqual(secret);
    expect(parseRecoveryKey(`  ${text}\n`)).toEqual(secret);
    // O for 0 and I/L for 1 are easy to mix up on paper.
    expect(parseRecoveryKey(formatRecoveryKey(secret).replace(/0/g, 'o').replace(/1/g, 'l'))).toEqual(secret);
  });

  it('catch every single mistyped character, wherever it is', () => {
    const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    for (let key = 0; key < 8; key++) {
      const text = newRecoveryKey().text.replace(/-/g, '');
      for (let i = 0; i < text.length; i++) {
        for (const other of alphabet) {
          if (other === text[i]) continue;
          expect(parseRecoveryKey(text.slice(0, i) + other + text.slice(i + 1))).toBeNull();
        }
      }
    }
  });

  it('catch two neighbouring characters swapped', () => {
    const text = newRecoveryKey().text.replace(/-/g, '');
    let swapped = 0;
    for (let i = 0; i < text.length - 1; i++) {
      if (text[i] === text[i + 1] || (text[i] + text[i + 1]).split('').sort().join('') === '0Z') continue; // the one pair a Luhn digit can't tell apart
      const wrong = text.slice(0, i) + text[i + 1] + text[i] + text.slice(i + 2);
      expect(parseRecoveryKey(wrong)).toBeNull();
      swapped++;
    }
    expect(swapped).toBeGreaterThan(20);
  });

  it('reject keys of the wrong length or alphabet', () => {
    expect(parseRecoveryKey('')).toBeNull();
    expect(parseRecoveryKey('ABCD-EFGH')).toBeNull();
    expect(parseRecoveryKey('U'.repeat(34))).toBeNull();
    expect(parseRecoveryKey(`${newRecoveryKey().text}-ABCD`)).toBeNull();
  });
});

describe('records', () => {
  const chat = { id: 'c1', title: 'Hello', messages: [{ role: 'user', content: 'My secret plan: 🚀 ünïcode' }] };

  it('round-trip', async () => {
    const key = await deriveKey(newRecoveryKey().secret);
    const blob = await encryptRecord(key, 'chat', 'rec-1', chat);
    expect(await decryptRecord(key, 'chat', 'rec-1', blob)).toEqual(chat);
  });

  it('are valid for the server and reveal nothing readable', async () => {
    const key = await deriveKey(newRecoveryKey().secret);
    const blob = await encryptRecord(key, 'chat', 'rec-1', chat);
    expect(blob).toMatch(BASE64);
    const raw = Buffer.from(blob, 'base64').toString('latin1');
    expect(raw).not.toContain('secret plan');
    expect(raw).not.toContain('Hello');
  });

  it('are different every time, even for the same content', async () => {
    const key = await deriveKey(newRecoveryKey().secret);
    expect(await encryptRecord(key, 'chat', 'rec-1', chat)).not.toBe(await encryptRecord(key, 'chat', 'rec-1', chat));
  });

  it('compress long chats', async () => {
    const key = await deriveKey(newRecoveryKey().secret);
    const long = { text: 'the quick brown fox jumps over the lazy dog. '.repeat(2000) };
    const blob = await encryptRecord(key, 'chat', 'rec-1', long);
    expect(blob.length).toBeLessThan(JSON.stringify(long).length / 20);
    expect(await decryptRecord(key, 'chat', 'rec-1', blob)).toEqual(long);
  });

  it('cannot be opened with another key', async () => {
    const blob = await encryptRecord(await deriveKey(newRecoveryKey().secret), 'chat', 'rec-1', chat);
    await expect(decryptRecord(await deriveKey(newRecoveryKey().secret), 'chat', 'rec-1', blob)).rejects.toBeInstanceOf(SyncCryptoError);
  });

  it('cannot be moved to another record or kind', async () => {
    const key = await deriveKey(newRecoveryKey().secret);
    const blob = await encryptRecord(key, 'chat', 'rec-1', chat);
    await expect(decryptRecord(key, 'chat', 'rec-2', blob)).rejects.toBeInstanceOf(SyncCryptoError);
    await expect(decryptRecord(key, 'memory', 'rec-1', blob)).rejects.toBeInstanceOf(SyncCryptoError);
  });

  it('notice any tampering', async () => {
    const key = await deriveKey(newRecoveryKey().secret);
    const bytes = Buffer.from(await encryptRecord(key, 'chat', 'rec-1', chat), 'base64');
    for (const index of [0, 5, 20, bytes.length - 1]) {
      const copy = Buffer.from(bytes);
      copy[index] ^= 1;
      await expect(decryptRecord(key, 'chat', 'rec-1', copy.toString('base64'))).rejects.toBeInstanceOf(SyncCryptoError);
    }
    await expect(decryptRecord(key, 'chat', 'rec-1', bytes.subarray(0, 10).toString('base64'))).rejects.toBeInstanceOf(SyncCryptoError);
    await expect(decryptRecord(key, 'chat', 'rec-1', '!!not base64!!')).rejects.toBeInstanceOf(SyncCryptoError);
  });

  it('uses a key that cannot be exported', async () => {
    const key = await deriveKey(newRecoveryKey().secret);
    expect(key.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('raw', key)).rejects.toThrow();
  });

  it('derives the same key from the same recovery key, on any device', async () => {
    const { secret } = newRecoveryKey();
    const blob = await encryptRecord(await deriveKey(secret), 'chat', 'r', chat);
    expect(await decryptRecord(await deriveKey(secret), 'chat', 'r', blob)).toEqual(chat);
  });
});

describe('verifier', () => {
  it('accepts the right recovery key and no other', async () => {
    const { secret } = newRecoveryKey();
    const verifier = await makeVerifier(await deriveKey(secret));
    expect(verifier).toMatch(BASE64);
    expect(await checkVerifier(await deriveKey(secret), verifier)).toBe(true);
    expect(await checkVerifier(await deriveKey(newRecoveryKey().secret), verifier)).toBe(false);
    expect(await checkVerifier(await deriveKey(secret), 'garbage')).toBe(false);
  });
});
