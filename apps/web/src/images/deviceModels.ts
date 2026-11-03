import type { ModelFile } from '../catalog';

/**
 * Image models the desktop app can run on the computer (apps/desktop/src/images/: stable-diffusion.cpp). Each is three
 * files with fixed names that main looks for: the image model, the text model that reads the prompt, and the decoder.
 * Only models with an open licence, downloadable without an account. Sizes are exact byte counts.
 */
export interface ImageModel {
  id: string;
  name: string;
  maker: string;
  licence: string;
  description: string;
  files: ModelFile[];
  /** Sampling steps and guidance for this model (a distilled model needs few steps and no guidance). */
  steps: number;
  cfg: number;
  /** Graphics memory (or an Apple silicon Mac's memory) it needs to be quick. */
  minMemoryGB: number;
  /** Changes a picture itself (the last one goes with the prompt). Without it, a change is made again from the prompt. */
  edits?: boolean;
}

const HF = 'https://huggingface.co';

export const DEVICE_IMAGE_MODELS: ImageModel[] = [
  {
    id: 'image-z-image-turbo',
    name: 'Z-Image Turbo',
    maker: 'Alibaba (Tongyi)',
    licence: 'Apache 2.0',
    description: 'The most detailed pictures and photos, in about 20 seconds on a graphics card.',
    files: [
      { url: `${HF}/leejet/Z-Image-Turbo-GGUF/resolve/main/z_image_turbo-Q4_K.gguf`, name: 'diffusion.gguf', sizeBytes: 3864250304 },
      { url: `${HF}/unsloth/Qwen3-4B-Instruct-2507-GGUF/resolve/main/Qwen3-4B-Instruct-2507-Q4_K_M.gguf`, name: 'text.gguf', sizeBytes: 2497281120 },
      { url: `${HF}/Comfy-Org/Z-Image-Turbo/resolve/main/split_files/vae/ae.safetensors`, name: 'vae.safetensors', sizeBytes: 335304388 },
    ],
    steps: 8,
    cfg: 1,
    minMemoryGB: 8,
  },
  {
    id: 'image-flux2-klein-4b',
    name: 'FLUX.2 klein 4B',
    maker: 'Black Forest Labs',
    licence: 'Apache 2.0',
    description: 'Quick pictures, in about 10 seconds, and it can change a picture you made. Smaller, for graphics cards with 6 GB.',
    files: [
      { url: `${HF}/unsloth/FLUX.2-klein-4B-GGUF/resolve/main/flux-2-klein-4b-Q4_K_M.gguf`, name: 'diffusion.gguf', sizeBytes: 2604311104 },
      { url: `${HF}/unsloth/Qwen3-4B-GGUF/resolve/main/Qwen3-4B-Q4_K_M.gguf`, name: 'text.gguf', sizeBytes: 2497281312 },
      { url: `${HF}/Comfy-Org/Flux-2-Klein-4B/resolve/main/split_files/vae/flux2-vae.safetensors`, name: 'vae.safetensors', sizeBytes: 336211292 },
    ],
    steps: 4,
    cfg: 1,
    minMemoryGB: 6,
    edits: true,
  },
];

/** The one to suggest: the most detailed that fits this computer's graphics memory well (measured on an 8 GB card). */
export function suggestedImageModel(memoryGB: number | null): ImageModel {
  const fits = DEVICE_IMAGE_MODELS.filter(model => memoryGB === null || memoryGB >= model.minMemoryGB);
  return fits[0] ?? DEVICE_IMAGE_MODELS[DEVICE_IMAGE_MODELS.length - 1];
}

export const imageModelBytes = (model: ImageModel): number => model.files.reduce((sum, file) => sum + file.sizeBytes, 0);
