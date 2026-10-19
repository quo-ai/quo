'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { describe, it } = require('node:test');
const { hasMtp, readGgufMeta } = require('../src/engine/gguf');
const { tempDir } = require('./tempdir');

const u32 = n => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
};
const u64 = n => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return b;
};
const str = s => Buffer.concat([u64(Buffer.byteLength(s)), Buffer.from(s)]);
const kvString = (key, value) => Buffer.concat([str(key), u32(8), str(value)]);
const kvU32 = (key, value) => Buffer.concat([str(key), u32(4), u32(value)]);
const kvStrings = (key, values) => Buffer.concat([str(key), u32(9), u32(8), u64(values.length), ...values.map(str)]);
const kvU32s = (key, values) => Buffer.concat([str(key), u32(9), u32(4), u64(values.length), ...values.map(u32)]);

function gguf(pairs, { version = 3, magic = 'GGUF', declared } = {}) {
  return Buffer.concat([Buffer.from(magic), u32(version), u64(0), u64(declared ?? pairs.length), ...pairs]);
}

const dir = tempDir('quo-gguf-');
const file = (name, buffer) => {
  const target = path.join(dir, name);
  fs.writeFileSync(target, buffer);
  return target;
};

describe('does a model file have a multi-token-prediction head?', () => {
  const tokens = Array.from({ length: 5000 }, (_, i) => `token${i}`);

  it('says yes when the file names one, even after a large tokenizer table, and reads the architecture', async () => {
    const target = file('mtp.gguf', gguf([kvString('general.architecture', 'qwen35'), kvU32('qwen35.block_count', 33), kvStrings('tokenizer.ggml.tokens', tokens), kvU32s('tokenizer.ggml.token_type', [1, 1, 3]), kvU32('qwen35.nextn_predict_layers', 1)]));
    assert.deepEqual(await readGgufMeta(target), { architecture: 'qwen35', nextnPredictLayers: 1 });
    assert.equal(await hasMtp(target), true);
  });

  it('says no when the file has no such key, or it is zero', async () => {
    const plain = file('plain.gguf', gguf([kvString('general.architecture', 'qwen35'), kvU32('qwen35.block_count', 32), kvStrings('tokenizer.ggml.tokens', tokens)]));
    assert.equal(await hasMtp(plain), false);
    assert.deepEqual(await readGgufMeta(plain), { architecture: 'qwen35', nextnPredictLayers: 0 });
    assert.equal(await hasMtp(file('zero.gguf', gguf([kvU32('llama.nextn_predict_layers', 0)]))), false);
  });

  it('finds the key under whatever architecture the model has', async () => {
    assert.equal(await hasMtp(file('other.gguf', gguf([kvString('general.architecture', 'glm4moe'), kvU32('glm4moe.nextn_predict_layers', 1)]))), true);
  });

  it('says no, never throws, for anything that is not a readable model file', async () => {
    assert.equal(await hasMtp(path.join(dir, 'missing.gguf')), false);
    assert.equal(await hasMtp(file('empty.gguf', Buffer.alloc(0))), false);
    assert.equal(await hasMtp(file('text.gguf', Buffer.from('not a model at all'))), false);
    assert.equal(await hasMtp(file('magic.gguf', gguf([kvU32('a.nextn_predict_layers', 1)], { magic: 'GGUX' }))), false);
    assert.equal(await hasMtp(file('version.gguf', gguf([kvU32('a.nextn_predict_layers', 1)], { version: 9 }))), false);
    assert.equal(await hasMtp(file('truncated.gguf', gguf([kvString('general.architecture', 'qwen35')], { declared: 40 }))), false);
    assert.equal(await hasMtp(file('huge-count.gguf', gguf([], { declared: 1e9 }))), false);
    assert.equal(await hasMtp(file('cut.gguf', gguf([kvStrings('tokenizer.ggml.tokens', tokens)]).subarray(0, 4000))), false);
  });

  it('does not trust a string or array length that would run away', async () => {
    const bad = Buffer.concat([Buffer.from('GGUF'), u32(3), u64(0), u64(1), u64(1 << 30), Buffer.from('x')]);
    assert.equal(await hasMtp(file('longkey.gguf', bad)), false);
    const arrays = Buffer.concat([Buffer.from('GGUF'), u32(3), u64(0), u64(1), str('k'), u32(9), u32(8), u64(1e12)]);
    assert.equal(await hasMtp(file('longarray.gguf', arrays)), false);
  });
});
