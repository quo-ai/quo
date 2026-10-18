import { DEFAULT_MODEL_ID } from '@/constants/models';

// Premium constants live outside PremiumContext so services (analytics
// remote-config defaults, memory/trial limit enforcement) can share them
// without importing a React context module. PremiumContext re-exports them
// for UI consumers.
export const PREMIUM_PRICE_FALLBACK = '$9.99';

// Premium feature names - centralized for consistency
export const PREMIUM_FEATURES = {
  CUSTOM_MODELS: 'Custom Models',
  THINKING_MODE: 'Thinking Mode',
  VISION: 'Image Analysis',
  VOICE_INPUT: 'Voice Input',
  VOICE_OUTPUT: 'Voice Output',
  ENHANCED_RECALL: 'Enhanced Recall',
  EXTRA_MODELS: 'Additional Models',
  UNLIMITED_MEMORY: 'Unlimited Memory',
  UNLIMITED_HISTORY: 'Unlimited History',
} as const;

export type PremiumFeature = typeof PREMIUM_FEATURES[keyof typeof PREMIUM_FEATURES];

// Free tier limits - keep onboarding fast, with a stronger free step-up after setup.
export const FREE_TIER_LIMITS = {
  MAX_MODELS: 3,
  MAX_MEMORY_SLOTS: 10,
  MAX_CHAT_HISTORY: 20,
  STARTER_MODEL_ID: DEFAULT_MODEL_ID,
  ALLOWED_MODEL_IDS: [
    DEFAULT_MODEL_ID, // Fast starter model
    'qwen35-2b', // Free quality step-up
    'ministral-3b-instruct', // Free vision model
  ] as string[],
};

export const PREMIUM_MAX_MEMORY_SLOTS = 100;

/** Canonical free-tier membership check — UI lock badges and the chat
 * send-path gating must never disagree. */
export function isFreeTierModel(modelId: string): boolean {
  return FREE_TIER_LIMITS.ALLOWED_MODEL_IDS.includes(modelId);
}
