'use strict';

// Image model families Quo can run from a file the person already has (custom.js), told apart by the tensors inside the
// file, never by its name. A checkpoint holds everything sd-cli needs; a diffusion-only file (a fine-tune of a model Quo
// offers) borrows the text model and decoder of that Quo model, which must be downloaded. Each family has its own steps,
// guidance and picture sizes.

const FAMILIES = {
  sdxl: { label: 'SDXL', kind: 'checkpoint', steps: 28, cfg: 6, sizes: 'standard' },
  sd1: { label: 'Stable Diffusion 1.5', kind: 'checkpoint', steps: 28, cfg: 7, sizes: 'small' },
  zimage: { label: 'Z-Image', kind: 'diffusion', base: 'image-z-image-turbo', baseName: 'Z-Image Turbo', steps: 8, cfg: 1, sizes: 'standard' },
  'flux2-klein': { label: 'FLUX.2 klein 4B', kind: 'diffusion', base: 'image-flux2-klein-4b', baseName: 'FLUX.2 klein 4B', steps: 4, cfg: 1, sizes: 'standard', edits: true },
};

/** What Quo says about a file it can't run. */
const UNSUPPORTED = 'Quo can’t run this kind of image model. It runs SDXL and Stable Diffusion 1.5 checkpoints (one file with everything), and Z-Image and FLUX.2 klein 4B models.';

/**
 * The family of an image model from its tensors ([{ name, shape }]), or null. Shapes are in either order (GGUF lists them
 * reversed). FLUX.2 klein 4B reads Qwen3-4B's output (7,680 wide); FLUX.1 and the other FLUX models don't, and aren't run.
 */
function familyOf(tensors) {
  if (!Array.isArray(tensors) || tensors.length === 0) return null;
  const names = new Set(tensors.map(tensor => tensor.name));
  const has = prefix => [...names].some(name => name.startsWith(prefix));
  const shape = name => tensors.find(tensor => tensor.name === name)?.shape ?? [];
  const whole = has('model.diffusion_model.') && has('first_stage_model.');
  if (whole && has('conditioner.embedders.1.')) return 'sdxl';
  // SD 1.x reads CLIP (cond_stage_model.transformer.…); SD 2.x has OpenCLIP there (cond_stage_model.model.…) and isn't run.
  if (whole && has('cond_stage_model.transformer.')) return 'sd1';
  if (has('cap_embedder.') && has('context_refiner.') && has('x_embedder.')) return 'zimage';
  if (has('double_blocks.') && has('single_blocks.') && shape('txt_in.weight').includes(7680)) return 'flux2-klein';
  return null;
}

module.exports = { FAMILIES, UNSUPPORTED, familyOf };
