// The facts for the website's model page (website/scripts/generate-pages.py → /models/), from the apps' own catalogs, so
// the page always says what the apps really offer. Writes website/scripts/models.json; a test fails when it is stale.
//   npm run models
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DESKTOP_MODELS, WEB_MODELS, type LocalModel } from '../src/catalog';

export interface PageModel {
  name: string;
  description: string;
  /** What is downloaded, in GB: the model and, for reading photos, its vision file (not optional speed-ups). */
  downloadGB: number;
  /** Memory the device should have for it to run well (computers only; the phone app checks the phone itself). */
  memoryGB?: number;
  photos: boolean;
  thinking: boolean;
  /** Computers: suited to Code mode. Phone: included free (otherwise Premium). */
  codeMode?: boolean;
  free?: boolean;
}

const MOBILE = fileURLToPath(new URL('../../mobile/constants/', import.meta.url));
const OUT = fileURLToPath(new URL('../../../website/scripts/models.json', import.meta.url));
const gb = (bytes: number) => Math.round(bytes / 1e8) / 10;

function computer(model: LocalModel): PageModel {
  return {
    name: model.name,
    description: model.description,
    downloadGB: gb(model.files.filter(file => !file.optional).reduce((sum, file) => sum + file.sizeBytes, 0)),
    memoryGB: model.minMemoryGB,
    photos: Boolean(model.vision),
    thinking: model.supportsThinking,
    codeMode: model.agent === 'good',
  };
}

/** The phone catalog imports app-only services, so its entries are read from the source text. */
function phoneModels(): PageModel[] {
  const source = readFileSync(`${MOBILE}models.ts`, 'utf8');
  const premium = readFileSync(`${MOBILE}premium.ts`, 'utf8');
  const starter = /export const DEFAULT_MODEL_ID = '([^']+)'/.exec(source)?.[1];
  const allowed = /ALLOWED_MODEL_IDS: \[([^\]]*)\]/.exec(premium)?.[1] ?? '';
  const free = new Set([...allowed.matchAll(/'([^']+)'/g)].map(match => match[1]).concat(allowed.includes('DEFAULT_MODEL_ID') && starter ? [starter] : []));
  const list = source.slice(source.indexOf('export const AVAILABLE_MODELS'));
  const entries: string[] = [];
  let depth = 0;
  let start = -1;
  for (let i = list.indexOf('= [') + 2; i < list.length; i++) {
    const char = list[i];
    if (char === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (char === '}') {
      depth--;
      if (depth === 0) entries.push(list.slice(start, i + 1));
    } else if (char === ']' && depth === 0) break;
  }
  const field = (entry: string, name: string) => new RegExp(`\\n    ${name}: '((?:[^'\\\\]|\\\\.)*)'`).exec(entry)?.[1]?.replace(/\\'/g, "'");
  return entries.map(entry => {
    const id = field(entry, 'id');
    const sizeBytes = Number(/\n {4}sizeBytes: (\d+)/.exec(entry)?.[1] ?? 0) + Number(/\n {4}mmprojSizeBytes: (\d+)/.exec(entry)?.[1] ?? 0);
    const features = /\n {4}features: \[([^\]]*)\]/.exec(entry)?.[1] ?? '';
    const name = field(entry, 'name');
    if (!id || !name || !sizeBytes) throw new Error(`A phone model couldn't be read from constants/models.ts: ${entry.slice(0, 80)}`);
    return {
      name,
      description: field(entry, 'description') ?? '',
      downloadGB: gb(sizeBytes),
      photos: /\n {4}hasVision: true/.test(entry),
      thinking: features.includes("'thinking'") || /\n {4}alwaysThinks: true/.test(entry),
      free: free.has(id),
    };
  });
}

export function modelsData() {
  return { desktop: DESKTOP_MODELS.map(computer), browser: WEB_MODELS.map(model => ({ ...computer(model), id: model.id })), phone: phoneModels() };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeFileSync(OUT, `${JSON.stringify(modelsData(), null, 1)}\n`);
  console.log(`wrote ${OUT}`);
}
