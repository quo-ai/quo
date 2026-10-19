'use strict';

const fsp = require('node:fs/promises');

/**
 * Reads what the engine needs to know from the start of a model file, without loading it: whether the file carries a
 * multi-token-prediction head (`<arch>.nextn_predict_layers` above zero), which llama-server can use to write several
 * tokens per step with no second model. The same Qwen3.5 model comes both with and without that head, and what is on disk
 * decides, so a model someone downloaded before the faster files existed keeps working as it did.
 *
 * Only the key-value block at the front is read, a piece at a time, and reading stops at the answer.
 */

const MAX_READ = 64 * 1024 * 1024;
const CHUNK = 1024 * 1024;
const FIXED = { 0: 1, 1: 1, 2: 2, 3: 2, 4: 4, 5: 4, 6: 4, 7: 1, 10: 8, 11: 8, 12: 8 }; // value type -> bytes (strings and arrays are handled apart)
const UINT = { 0: 'readUInt8', 2: 'readUInt16LE', 4: 'readUInt32LE' };

class Reader {
  constructor(handle) {
    this.handle = handle;
    this.buffer = Buffer.alloc(0);
    this.offset = 0; // of the start of `buffer` in the file
    this.position = 0;
  }

  async need(bytes) {
    const end = this.position + bytes;
    if (end > MAX_READ) throw new Error('header too large');
    if (end <= this.offset + this.buffer.length && this.position >= this.offset) return;
    const start = this.position;
    const wanted = Math.max(CHUNK, bytes);
    const next = Buffer.alloc(wanted);
    const { bytesRead } = await this.handle.read(next, 0, wanted, start);
    if (bytesRead < bytes) throw new Error('unexpected end of file');
    this.buffer = next.subarray(0, bytesRead);
    this.offset = start;
  }

  async bytes(count) {
    await this.need(count);
    const from = this.position - this.offset;
    this.position += count;
    return this.buffer.subarray(from, from + count);
  }

  async u32() {
    return (await this.bytes(4)).readUInt32LE(0);
  }

  async u64() {
    const big = (await this.bytes(8)).readBigUInt64LE(0);
    if (big > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('number too large');
    return Number(big);
  }

  async string(limit = 1 << 20) {
    const length = await this.u64();
    if (length > limit) throw new Error('string too long');
    return (await this.bytes(length)).toString('utf8');
  }

  skip(count) {
    this.position += count;
  }
}

/** One value: its number if it is a whole number we may want, else undefined. */
async function value(reader, type) {
  if (type === 8) {
    await reader.string();
    return undefined;
  }
  if (type === 9) {
    const elementType = await reader.u32();
    const count = await reader.u64();
    if (elementType === 8) for (let i = 0; i < count; i++) await reader.string();
    else if (FIXED[elementType]) reader.skip(FIXED[elementType] * count);
    else throw new Error('unknown array type');
    return undefined;
  }
  const size = FIXED[type];
  if (!size) throw new Error('unknown value type');
  const bytes = await reader.bytes(size);
  return UINT[type] ? bytes[UINT[type]](0) : type === 10 ? Number(bytes.readBigUInt64LE(0)) : undefined;
}

/** `{ architecture, nextnPredictLayers }` of a GGUF file, or null if it cannot be read as one. */
async function readGgufMeta(file) {
  let handle;
  try {
    handle = await fsp.open(file, 'r');
    const reader = new Reader(handle);
    if ((await reader.bytes(4)).toString('latin1') !== 'GGUF') return null;
    const version = await reader.u32();
    if (version < 2 || version > 3) return null;
    await reader.u64(); // tensor count
    const pairs = await reader.u64();
    if (pairs > 10_000) return null;
    const meta = { architecture: null, nextnPredictLayers: 0 };
    for (let i = 0; i < pairs; i++) {
      const key = await reader.string();
      const type = await reader.u32();
      if (key === 'general.architecture' && type === 8) {
        meta.architecture = await reader.string();
        continue;
      }
      const found = await value(reader, type);
      if (key.endsWith('.nextn_predict_layers') && typeof found === 'number') {
        meta.nextnPredictLayers = found;
        return meta; // that is the answer: stop reading
      }
    }
    return meta;
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => {});
  }
}

/** Whether the file has a multi-token-prediction head. False when it cannot be told. */
async function hasMtp(file) {
  return ((await readGgufMeta(file))?.nextnPredictLayers ?? 0) > 0;
}

module.exports = { readGgufMeta, hasMtp };
