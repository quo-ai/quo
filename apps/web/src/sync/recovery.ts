/**
 * The recovery key: what a person writes down, and how it's read back. Pure
 * functions with no platform dependencies, so this file is the same on every
 * platform (apps/web/src/sync/ is the original; apps/mobile/services/sync/ has a
 * copy that scripts/check-shared-sync.js keeps identical).
 *
 * 160 random bits shown as 8 groups of 4 letters/digits, then 2 check characters
 * that catch typos (Luhn mod-32 + part of a CRC-16). Crockford base32 has no
 * I, L, O or U, so a key read aloud or off paper is hard to get wrong. Where the
 * random bits come from is the platform's business (crypto.ts).
 */

export const SECRET_BYTES = 20;

// Crockford base32: no I, L, O, U, so a key read aloud or off paper is hard to get wrong.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function encode32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function decode32(text: string): Uint8Array | null {
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of text) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) return null;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Uint8Array.from(out);
}

/**
 * Two check characters that catch typos. The first is a Luhn mod-32 digit over
 * the key's characters, which is guaranteed to catch any single wrong character
 * (and nearly every swapped pair); the second is part of a CRC-16 of the
 * secret, which catches most other mistakes.
 */
function checkChars(secret: Uint8Array): string {
  const body = encode32(secret);
  let sum = 0;
  let factor = 2;
  for (let i = body.length - 1; i >= 0; i--) {
    const addend = factor * ALPHABET.indexOf(body[i]);
    factor = factor === 2 ? 1 : 2;
    sum += Math.floor(addend / 32) + (addend % 32);
  }
  const luhn = ALPHABET[(32 - (sum % 32)) % 32];

  let crc = 0xffff;
  for (const byte of secret) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return luhn + ALPHABET[crc & 31];
}

export function formatRecoveryKey(secret: Uint8Array): string {
  const body = encode32(secret); // 32 characters
  const groups = body.match(/.{4}/g)!;
  return [...groups, checkChars(secret)].join('-');
}

/**
 * Reads a recovery key the way people type it: any case, with or without
 * dashes and spaces, O for 0 and I or L for 1. Null if it isn't a valid key.
 */
export function parseRecoveryKey(input: string): Uint8Array | null {
  const text = input.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (text.length !== 34) return null;
  const secret = decode32(text.slice(0, 32));
  if (!secret || secret.length !== SECRET_BYTES) return null;
  return checkChars(secret) === text.slice(32) ? secret : null;
}
