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
}

const HF = 'https://huggingface.co';

export const DEVICE_IMAGE_MODELS: ImageModel[] = [
  {
    id: 'image-z-image-turbo',
    name: 'Z-Image Turbo',
    maker: 'Alibaba (Tongyi)',
    licence: 'Apache 2.0',
    description: 'Photos and illustrations from a description, in about 20 seconds on a graphics card.',
    files: [
      { url: `${HF}/leejet/Z-Image-Turbo-GGUF/resolve/main/z_image_turbo-Q4_K.gguf`, name: 'diffusion.gguf', sizeBytes: 3864250304 },
      { url: `${HF}/unsloth/Qwen3-4B-Instruct-2507-GGUF/resolve/main/Qwen3-4B-Instruct-2507-Q4_K_M.gguf`, name: 'text.gguf', sizeBytes: 2497281120 },
      { url: `${HF}/Comfy-Org/Z-Image-Turbo/resolve/main/split_files/vae/ae.safetensors`, name: 'vae.safetensors', sizeBytes: 335304388 },
    ],
    steps: 8,
    cfg: 1,
    minMemoryGB: 8,
  },
];

export const imageModelBytes = (model: ImageModel): number => model.files.reduce((sum, file) => sum + file.sizeBytes, 0);
