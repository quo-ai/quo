import type { LocalModel, ModelFile } from '../catalog';
import { ENGINE_ARCHITECTURES } from './architectures';

/**
 * Any GGUF model on Hugging Face, for the desktop app's engine (vLLM's "200+ architectures": llama.cpp loads about 160,
 * and the catalog lists a handful). Search and file lists come from Hugging Face's public API, which also says each
 * repository's architecture, so a model the engine can't load is marked before anything is downloaded. Files go through
 * the same checked downloader as the catalog (Hugging Face only, exact sizes, the GGUF signature).
 */

const HF = 'https://huggingface.co';
/** owner/name, each starting with a letter or digit, never "..": nothing else becomes part of an address. */
const REPO = /^(?!.*\.\.)[A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.-]*$/;

/** Architectures the engine loads that make embeddings or speech, not chat. */
const NOT_CHAT = /bert|embed(?!ded)|t5encoder|wavtokenizer|tts$|^clef$|decision/;

export type Support = 'yes' | 'not-chat' | 'newer-engine' | 'unknown';

export interface RepoResult {
  repo: string;
  downloads: number;
  likes: number;
  architecture: string | null;
  /** The longest window the model was trained for, in tokens. */
  contextLength: number | null;
  /** Parameters, when Hugging Face knows. */
  parameters: number | null;
  /** The chat template has a thinking switch. */
  thinking: boolean;
  support: Support;
}

export interface RepoFile {
  path: string;
  sizeBytes: number;
  /** Q4_K_M, IQ4_XS, Q8_0, BF16…, or null. */
  quant: string | null;
}

export interface RepoFiles {
  models: RepoFile[];
  /** Vision projectors (mmproj), smallest last-resort first. */
  projectors: RepoFile[];
}

export function supportOf(architecture: string | null | undefined): Support {
  if (!architecture) return 'unknown';
  if (!ENGINE_ARCHITECTURES.has(architecture)) return 'newer-engine';
  return NOT_CHAT.test(architecture) ? 'not-chat' : 'yes';
}

interface ApiModel {
  id?: unknown;
  downloads?: unknown;
  likes?: unknown;
  gguf?: { architecture?: unknown; context_length?: unknown; total?: unknown; chat_template?: unknown } | null;
}

const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null);

export function toRepoResult(model: ApiModel): RepoResult | null {
  if (typeof model.id !== 'string' || !REPO.test(model.id)) return null;
  const architecture = typeof model.gguf?.architecture === 'string' ? model.gguf.architecture : null;
  const template = typeof model.gguf?.chat_template === 'string' ? model.gguf.chat_template : '';
  return {
    repo: model.id,
    downloads: num(model.downloads) ?? 0,
    likes: num(model.likes) ?? 0,
    architecture,
    contextLength: num(model.gguf?.context_length),
    parameters: num(model.gguf?.total),
    thinking: /enable_thinking/.test(template),
    support: supportOf(architecture),
  };
}

/** GGUF repositories matching the words, most downloaded first. */
export async function searchModels(query: string, signal?: AbortSignal): Promise<RepoResult[]> {
  const params = new URLSearchParams({ search: query.trim().slice(0, 100), filter: 'gguf', sort: 'downloads', direction: '-1', limit: '24' });
  for (const field of ['gguf', 'downloads', 'likes']) params.append('expand[]', field);
  const response = await fetch(`${HF}/api/models?${params}`, { signal });
  if (!response.ok) throw new Error('Hugging Face didn’t answer. Check your connection and try again.');
  const list = (await response.json()) as ApiModel[];
  return (Array.isArray(list) ? list : []).map(toRepoResult).filter((result): result is RepoResult => Boolean(result));
}

const QUANT = /(?:^|[-_.])((?:UD-)?(?:I?Q\d(?:_[0-9A-Z]+)*|BF16|F16|F32|MXFP4(?:_MOE)?))(?=\.gguf$|[-_.])/i;

export const quantOf = (path: string): string | null => QUANT.exec(path.split('/').pop() ?? '')?.[1]?.toUpperCase() ?? null;

/** The repository's single-file models and its vision projectors. Split models (-00001-of-0000N) and drafters are left out. */
export function sortFiles(tree: { type?: unknown; path?: unknown; size?: unknown; lfs?: { size?: unknown } | null }[]): RepoFiles {
  const files: RepoFile[] = [];
  for (const entry of tree) {
    if (entry.type !== 'file' || typeof entry.path !== 'string' || !entry.path.toLowerCase().endsWith('.gguf')) continue;
    const sizeBytes = num(entry.lfs?.size) ?? num(entry.size);
    if (!sizeBytes) continue;
    files.push({ path: entry.path, sizeBytes, quant: quantOf(entry.path) });
  }
  const name = (file: RepoFile) => file.path.split('/').pop()!.toLowerCase();
  const projectors = files.filter(file => name(file).includes('mmproj')).sort((a, b) => a.sizeBytes - b.sizeBytes);
  const models = files
    .filter(file => !name(file).includes('mmproj') && !/-\d{5}-of-\d{5}\.gguf$/.test(name(file)) && !/^mtp-|drafter|imatrix/.test(name(file)))
    .sort((a, b) => a.sizeBytes - b.sizeBytes);
  return { models, projectors };
}

export async function repoFiles(repo: string, signal?: AbortSignal): Promise<RepoFiles> {
  if (!REPO.test(repo)) throw new Error('That isn’t a Hugging Face model.');
  const response = await fetch(`${HF}/api/models/${repo}/tree/main?recursive=true`, { signal });
  if (!response.ok) throw new Error('Couldn’t list that model’s files.');
  const tree = await response.json();
  return sortFiles(Array.isArray(tree) ? tree : []);
}

/** A parameter count as people write it: 3.7B, 30B, 270M. */
export const parameterCount = (n: number): string => (n >= 1e9 ? `${Number((n / 1e9).toFixed(n >= 1e10 ? 0 : 1))}B` : `${Math.round(n / 1e6)}M`);

/** Bits a weight takes in a quantization: 4 for Q4_K_M, 16 for BF16; null when the name doesn't say. */
export function bitsOf(quant: string | null): number | null {
  if (!quant) return null;
  if (/^(?:UD-)?MXFP4/.test(quant)) return 4;
  const float = /^(?:B?F)(\d+)$/.exec(quant);
  if (float) return Number(float[1]);
  const q = /^(?:UD-)?I?Q(\d)/.exec(quant);
  return q ? Number(q[1]) : null;
}

/**
 * The file to suggest: 4-bit medium where it fits (the usual balance of size and quality), else the largest that fits,
 * never under 3 bits (1- and 2-bit files answer badly): when nothing good fits, 4-bit medium anyway, which the list then
 * marks as likely too large. "Fits" leaves room for the window and the rest of the computer: 75% of the memory.
 */
export function suggestFile(models: RepoFile[], memoryGB: number | null): RepoFile | null {
  if (!models.length) return null;
  const room = (memoryGB ?? 8) * 2 ** 30 * 0.75;
  const good = models.filter(file => (bitsOf(file.quant) ?? 4) >= 3);
  const fits = good.filter(file => file.sizeBytes <= room);
  const preferred = ['Q4_K_M', 'UD-Q4_K_XL', 'Q4_K_S', 'IQ4_XS', 'Q4_0'];
  for (const quant of preferred) {
    const match = fits.find(file => file.quant === quant);
    if (match) return match;
  }
  if (fits.length) return fits.at(-1)!;
  for (const quant of preferred) {
    const match = good.find(file => file.quant === quant);
    if (match) return match;
  }
  return good[0] ?? models[0];
}

/** A short id the models folder accepts ([a-z0-9._-], at most 64 characters), the same for the same file. */
export function modelIdFor(repo: string, path: string): string {
  const base = `${repo.split('/')[1]}-${quantOf(path) ?? path.split('/').pop()!.replace(/\.gguf$/i, '')}`.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/-+/g, '-');
  let hash = 0;
  for (const char of `${repo}/${path}`) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return `hf-${base.slice(0, 50).replace(/^[-.]+|[-.]+$/g, '')}-${hash.toString(36)}`.slice(0, 64);
}

const fileUrl = (repo: string, path: string) => `${HF}/${repo}/resolve/main/${path.split('/').map(encodeURIComponent).join('/')}`;

/** The model entry for a chosen file (and projector), stored and listed like a catalog model. */
export function toLocalModel(result: Pick<RepoResult, 'repo' | 'contextLength' | 'thinking'>, file: RepoFile, projector: RepoFile | null): LocalModel {
  const files: ModelFile[] = [{ url: fileUrl(result.repo, file.path), name: 'model.gguf', sizeBytes: file.sizeBytes }];
  if (projector) files.push({ url: fileUrl(result.repo, projector.path), name: 'mmproj.gguf', sizeBytes: projector.sizeBytes });
  const name = result.repo.split('/')[1].replace(/[-_]GGUF$/i, '');
  return {
    id: modelIdFor(result.repo, file.path),
    name: file.quant ? `${name} (${file.quant})` : name,
    description: `From Hugging Face: ${result.repo}.`,
    files,
    // What it was trained for, but no more than a typical computer holds; the engine holds it back further if needed.
    contextSize: Math.min(result.contextLength ?? 8192, 16384),
    maxTokens: 4096,
    sampling: { temperature: 0.7, top_p: 0.9, top_k: 40, min_p: 0.05 },
    supportsThinking: result.thinking,
    minMemoryGB: Math.max(4, Math.ceil(((file.sizeBytes + (projector?.sizeBytes ?? 0)) / 2 ** 30) * 1.3)),
    vision: Boolean(projector),
    native: true,
    source: { kind: 'huggingface', repo: result.repo },
  };
}
