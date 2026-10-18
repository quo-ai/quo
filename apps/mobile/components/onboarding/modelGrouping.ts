import { AVAILABLE_MODELS, ModelConfig } from '@/constants/models';
import { isFreeTierModel } from '@/constants/premium';

// Sort by sizeBytes ascending, with zero/unknown sizes last
export function compareModelsBySize(a: { sizeBytes: number }, b: { sizeBytes: number }): number {
  const aSize = a.sizeBytes > 0 ? a.sizeBytes : Number.POSITIVE_INFINITY;
  const bSize = b.sizeBytes > 0 ? b.sizeBytes : Number.POSITIVE_INFINITY;
  return aSize - bSize;
}

// Model family definitions
export interface ModelFamily {
  id: string;
  name: string;
  description: string;
  icon: string;
  badge?: 'fastest' | 'recommended' | 'best';
  models: ModelConfig[];
}

// Catalog families, matched by model id prefix. Every catalog model must
// land in exactly one family — anything unmatched falls into "More models"
// so new catalog entries can never silently vanish from onboarding.
const FAMILY_DEFINITIONS: (Omit<ModelFamily, 'models'> & { idPrefix: string })[] = [
  {
    id: 'qwen35',
    idPrefix: 'qwen35-',
    name: 'Qwen 3.5 by Alibaba',
    description: 'Next-gen multimodal AI with vision, 201 languages, and hybrid reasoning. Built for mobile.',
    icon: 'vision',
    badge: 'recommended',
  },
  {
    id: 'gemma',
    idPrefix: 'gemma',
    name: 'Gemma 3 by Google',
    description: 'Multilingual all-rounders, from a tiny fast model to a 4B with vision.',
    icon: 'vision',
  },
  {
    id: 'ministral',
    idPrefix: 'ministral',
    name: 'Ministral 3 by Mistral AI',
    description: 'Can see and analyse images. Send a photo and ask anything about it.',
    icon: 'vision',
  },
  {
    id: 'phi',
    idPrefix: 'phi',
    name: 'Phi-4 by Microsoft',
    description: 'Compact reasoning specialist. Excellent at math, logic, and structured answers.',
    icon: 'thinking',
  },
  {
    id: 'llama',
    idPrefix: 'llama',
    name: 'Llama 3.2 by Meta',
    description: 'Dependable generalist for balanced chat, writing, and summarisation.',
    icon: 'sparkles',
  },
  {
    id: 'smollm',
    idPrefix: 'smollm',
    name: 'SmolLM by Hugging Face',
    description: 'Compact text model with strong writing, coding, and European language coverage.',
    icon: 'thinking',
  },
  {
    id: 'nanbeige',
    idPrefix: 'nanbeige',
    name: 'Nanbeige by Nanbeige AI',
    description: 'Deep reasoning with a built-in thinking mode for complex problems.',
    icon: 'thinking',
  },
];

export function getModelFamilies(models: ModelConfig[] = AVAILABLE_MODELS): ModelFamily[] {
  const assigned = new Set<string>();
  const families: ModelFamily[] = FAMILY_DEFINITIONS.map(({ idPrefix, ...family }) => {
    const familyModels = models.filter(m => !assigned.has(m.id) && m.id.startsWith(idPrefix));
    familyModels.forEach(m => assigned.add(m.id));
    return { ...family, models: familyModels };
  });

  const unassigned = models.filter(m => !assigned.has(m.id));
  if (unassigned.length > 0) {
    families.push({
      id: 'other',
      name: 'More models',
      description: 'Additional on-device models.',
      icon: 'sparkles',
      models: unassigned,
    });
  }

  families.push({
    id: 'custom',
    name: 'Custom Model (GGUF)',
    description: 'Load your own local GGUF model files via Settings.',
    icon: 'sparkles',
    models: [],
  });

  return families
    .filter(f => f.id === 'custom' || f.models.length > 0)
    .map(f => ({
      ...f,
      models: [...f.models].sort(compareModelsBySize),
    }));
}

// Check if a family has any free models
export function familyHasFreeModel(family: ModelFamily): boolean {
  return family.models.some(m => isFreeTierModel(m.id));
}

// Check if a family is fully locked (no free models and user is not premium)
export function isFamilyLocked(family: ModelFamily, isPremium: boolean): boolean {
  if (family.id === 'custom') return !isPremium;
  return !isPremium && !familyHasFreeModel(family);
}

// Get family features (combined from all models)
export function getFamilyFeatures(family: ModelFamily): { hasVision: boolean; hasReasoning: boolean; hasTools: boolean } {
  const hasVision = family.models.some(m => m.hasVision);
  const hasReasoning = family.models.some(m => m.features.includes('reasoning'));
  const hasTools = family.models.some(m => m.features.includes('tools'));
  return { hasVision, hasReasoning, hasTools };
}

// Get size range for family
export function getFamilySizeRange(family: ModelFamily): string {
  if (family.id === 'custom') return 'Any size';
  const sizes = family.models.map(m => m.size);
  if (sizes.length === 1) return sizes[0];
  return `${sizes[0]} - ${sizes[sizes.length - 1]}`;
}

// Check if any model in family is downloaded
export function familyHasDownloadedModel(family: ModelFamily, downloadedModels: Set<string>): boolean {
  return family.models.some(m => downloadedModels.has(m.id));
}

// Sort families so locked ones sink to the bottom, keeping original order otherwise
export function sortFamiliesByLocked(families: ModelFamily[], isPremium: boolean): ModelFamily[] {
  return [...families].sort((a, b) => {
    const aLocked = isFamilyLocked(a, isPremium);
    const bLocked = isFamilyLocked(b, isPremium);

    // Only sort by locked status - keep original order otherwise
    if (aLocked !== bLocked) return aLocked ? 1 : -1;

    return 0;
  });
}
