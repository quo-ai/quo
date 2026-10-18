import { ImageAttachment, DocumentAttachment, AppSettings } from '@/types/chat';
import { llmService } from '@/services/llm';
import { getDefaultModel, getModelById, ModelConfig } from '@/constants/models';
import { FREE_TIER_LIMITS } from '@/constants/premium';

export { isFreeTierModel } from '@/constants/premium';

export function getFreeStarterModel() {
  return getModelById(FREE_TIER_LIMITS.STARTER_MODEL_ID) || getDefaultModel();
}

// Returns settings updated to reflect the given model (identity plus its
// recommended generation parameters).
export function applyModelToSettings(settings: AppSettings, model: ModelConfig): AppSettings {
  return {
    ...settings,
    modelId: model.id,
    modelName: model.name,
    temperature: model.recommendedSettings.temperature,
    maxTokens: model.recommendedSettings.maxTokens,
  };
}

export function getTaskType(content: string, image?: ImageAttachment, document?: DocumentAttachment): string {
  if (document) return 'document';
  if (image) return 'image';
  if (content.trim().length === 0) return 'empty';
  return 'chat';
}

export function getCurrentModelAnalyticsParams(source: string, isPremium: boolean) {
  const model = llmService.getCurrentModel();
  return {
    source,
    model_id: model.id,
    size_bytes: model.sizeBytes,
    has_vision: Boolean(model.hasVision),
    is_premium: isPremium,
    loaded_from_asset: llmService.wasLoadedFromAsset(),
  };
}

export function stripImageBase64(image?: ImageAttachment): ImageAttachment | undefined {
  if (!image?.base64) return image;
  const { base64: _base64, ...safeImage } = image;
  return safeImage;
}
