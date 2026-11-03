'use strict';

// Image models the person already has (src/images/custom.js, families.js): recognised by the tensors inside the file,
// never its name; the path stays in main; a fine-tune needs the Quo model it was made from; a file that moved or changed
// is refused. Tries files that lie about what they are.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');
const { familyOf } = require('../../src/images/families');
const { CustomImageModels } = require('../../src/images/custom');
const { readGgufTensors } = require('../../src/engine/gguf');
const { ModelStore } = require('../../src/engine/models');
const { tempDir } = require('../tempdir');

const t = (name, shape = [4]) => ({ name, shape });
const SDXL = [t('model.diffusion_model.input_blocks.0.0.weight'), t('first_stage_model.decoder.conv_in.weight'), t('conditioner.embedders.1.model.ln_final.weight')];
const SD1 = [t('model.diffusion_model.input_blocks.0.0.weight'), t('first_stage_model.decoder.conv_in.weight'), t('cond_stage_model.transformer.text_model.final_layer_norm.weight')];
const ZIMAGE = [t('cap_embedder.1.weight', [2560, 3840]), t('context_refiner.0.attention.qkv.weight'), t('x_embedder.weight')];
const KLEIN = [t('double_blocks.0.img_attn.qkv.weight'), t('single_blocks.0.linear1.weight'), t('txt_in.weight', [3072, 7680])];
const FLUX1 = [t('double_blocks.0.img_attn.qkv.weight'), t('single_blocks.0.linear1.weight'), t('txt_in.weight', [3072, 4096])];

function safetensors(file, tensors) {
  const header = Buffer.from(JSON.stringify(Object.fromEntries(tensors.map(({ name, shape }) => [name, { dtype: 'F16', shape, data_offsets: [0, 0] }]))));
  const length = Buffer.alloc(8);
  length.writeBigUInt64LE(BigInt(header.length));
  fs.writeFileSync(file, Buffer.concat([length, header, Buffer.alloc(16)]));
}
function gguf(file, tensors) {
  const parts = [Buffer.from('GGUF'), Buffer.alloc(4), Buffer.alloc(8), Buffer.alloc(8)];
  parts[1].writeUInt32LE(3);
  parts[2].writeBigUInt64LE(BigInt(tensors.length));
  for (const { name, shape } of tensors) {
    const len = Buffer.alloc(8);
    len.writeBigUInt64LE(BigInt(Buffer.byteLength(name)));
    const dims = Buffer.alloc(4);
    dims.writeUInt32LE(shape.length);
    const sizes = shape.map(size => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(size)); return b; });
    parts.push(len, Buffer.from(name), dims, ...sizes, Buffer.alloc(4), Buffer.alloc(8));
  }
  fs.writeFileSync(file, Buffer.concat(parts));
}

describe('which family a file belongs to', () => {
  it('is read from its tensors, in either shape order, and FLUX.1 or anything else is not run', () => {
    assert.equal(familyOf(SDXL), 'sdxl');
    assert.equal(familyOf(SD1), 'sd1');
    assert.equal(familyOf(ZIMAGE), 'zimage');
    assert.equal(familyOf(KLEIN), 'flux2-klein');
    assert.equal(familyOf(KLEIN.map(x => ({ ...x, shape: [...x.shape].reverse() }))), 'flux2-klein');
    assert.equal(familyOf(FLUX1), null);
    for (const value of [[], null, [t('token_embd.weight'), t('blk.0.attn_q.weight')], [t('model.diffusion_model.x')]]) assert.equal(familyOf(value), null);
  });

  it('reads a GGUF file’s tensor names and shapes', async () => {
    const file = path.join(tempDir('quo-gguf-'), 'm.gguf');
    gguf(file, KLEIN);
    assert.deepEqual((await readGgufTensors(file)).map(x => x.name), KLEIN.map(x => x.name));
  });
});

describe('the person’s own image models', () => {
  const setup = () => {
    const root = tempDir('quo-custom-');
    const store = new ModelStore({ directory: path.join(root, 'models'), customFile: path.join(root, 'c.json'), emit() {} });
    return { root, store, custom: new CustomImageModels({ listFile: path.join(root, 'custom-image-models.json'), store }) };
  };

  it('adds a checkpoint it recognises, shows the page no path, and runs it as one file', async () => {
    const { root, custom } = setup();
    const file = path.join(root, 'My Fancy XL.safetensors');
    safetensors(file, SDXL);
    const shown = await custom.add(file);
    assert.deepEqual(Object.keys(shown).sort(), ['cfg', 'edits', 'family', 'id', 'label', 'name', 'steps']);
    assert.equal(shown.name, 'My Fancy XL');
    assert.equal(JSON.stringify(await custom.list()).includes(root), false);
    assert.deepEqual(await custom.resolve(shown.id), { family: 'sdxl', files: { checkpoint: fs.realpathSync(file) } });
  });

  it('refuses a file that isn’t an image model it can run, whatever it is called', async () => {
    const { root, custom } = setup();
    const named = (name, write) => { const file = path.join(root, name); write(file); return file; };
    await assert.rejects(custom.add(named('notes.txt', f => fs.writeFileSync(f, 'x'))), { code: 'unsupported' });
    await assert.rejects(custom.add(named('sdxl.safetensors', f => fs.writeFileSync(f, 'not a header'))), { code: 'unsupported' });
    await assert.rejects(custom.add(named('flux1-dev.safetensors', f => safetensors(f, FLUX1))), { code: 'unsupported' });
    await assert.rejects(custom.add(named('llama.gguf', f => gguf(f, [t('token_embd.weight'), t('blk.0.attn_q.weight')]))), { code: 'unsupported' });
    assert.deepEqual(await custom.list(), []);
  });

  it('runs a fine-tune with the text model and decoder of the Quo model it was made from, once that is downloaded', async () => {
    const { root, store, custom } = setup();
    const file = path.join(root, 'klein-finetune.gguf');
    gguf(file, KLEIN);
    const { id, needs } = await custom.add(file);
    assert.equal(needs, 'FLUX.2 klein 4B');
    await assert.rejects(custom.resolve(id), { code: 'needs_base' });
    const base = path.join(root, 'models', 'image-flux2-klein-4b');
    fs.mkdirSync(base, { recursive: true });
    gguf(path.join(base, 'text.gguf'), [t('token_embd.weight')]);
    safetensors(path.join(base, 'vae.safetensors'), [t('decoder.conv_in.weight')]);
    const resolved = await custom.resolve(id);
    assert.equal(resolved.files.diffusion, fs.realpathSync(file));
    assert.equal(resolved.files.text, store.filePath('image-flux2-klein-4b', 'text.gguf'));
  });

  it('refuses a file that changed into something else, or went away', async () => {
    const { root, custom } = setup();
    const file = path.join(root, 'model.safetensors');
    safetensors(file, SD1);
    const { id } = await custom.add(file);
    safetensors(file, FLUX1);
    await assert.rejects(custom.resolve(id), { code: 'not_installed' });
    fs.rmSync(file);
    await assert.rejects(custom.resolve(id), { code: 'not_installed' });
    await assert.rejects(custom.resolve('imgc-../../etc'), { code: 'not_installed' });
  });
});
