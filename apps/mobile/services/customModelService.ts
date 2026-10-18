/**
 * Custom Model Service - Manages user-added custom GGUF models
 * Handles storage, validation, and CRUD operations for custom models
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getSystemPrompt } from '@/constants/system-prompts';
import { ModelFeature, ToolFormat } from '@/constants/models';

const CUSTOM_MODELS_KEY = '@custom_models';

// Define CustomModelConfig with all fields inline to avoid circular imports
export interface CustomModelConfig {
  id: string;
  name: string;
  description: string;
  size: string;
  sizeBytes: number;
  modelUrl: string;
  modelFilename: string;
  hasVision: boolean;
  mmprojUrl?: string;
  mmprojFilename?: string;
  mmprojSizeBytes?: number;
  recommendedSettings: {
    temperature: number;
    maxTokens: number;
    contextSize: number;
    topP?: number;
    topK?: number;
    minP?: number;
    presencePenalty?: number;
    repeatPenalty?: number;
    penaltyLastN?: number;
    nBatch?: number;
    nThreads?: number;
    nGpuLayers?: number;
    flashAttn?: 'auto' | 'on' | 'off';
    cacheTypeK?: 'f16' | 'f32' | 'q8_0' | 'q4_0' | 'q4_1' | 'iq4_nl' | 'q5_0' | 'q5_1';
    cacheTypeV?: 'f16' | 'f32' | 'q8_0' | 'q4_0' | 'q4_1' | 'iq4_nl' | 'q5_0' | 'q5_1';
  };
  systemPrompt: string;
  features: ModelFeature[];
  stopSequences: string[];
  /** Unknown chat template, so tools use the portable text protocol. */
  toolFormat: ToolFormat;
  isCustom: true;
  addedAt: number;
}

// Default settings for custom models (conservative for mobile)
const DEFAULT_CUSTOM_MODEL_SETTINGS = {
  temperature: 0.3,
  maxTokens: 2048,
  contextSize: 8192,
  topP: 0.95,
  topK: 40,
  minP: 0.05,
  repeatPenalty: 1.0,
  penaltyLastN: 64,
  nBatch: 512,
  nThreads: 4,
  nGpuLayers: 40,
  flashAttn: 'auto' as const,
  cacheTypeK: 'f16' as const,
  cacheTypeV: 'f16' as const,
};

class CustomModelService {
  private static instance: CustomModelService;
  private customModels: CustomModelConfig[] = [];
  private listeners: Set<(models: CustomModelConfig[]) => void> = new Set();
  private initialized = false;

  private constructor() { }

  static getInstance(): CustomModelService {
    if (!CustomModelService.instance) {
      CustomModelService.instance = new CustomModelService();
    }
    return CustomModelService.instance;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      const stored = await AsyncStorage.getItem(CUSTOM_MODELS_KEY);
      if (stored) {
        // Refresh app-owned fields on saved models: the system prompt and
        // defaults are the app's, not the user's, and older saves carry
        // outdated ones (long rule-list prompt, repeat penalty 1.1).
        this.customModels = (JSON.parse(stored) as CustomModelConfig[]).map(model => ({
          ...model,
          systemPrompt: getSystemPrompt('default'),
          toolFormat: 'text',
          recommendedSettings: {
            ...model.recommendedSettings,
            repeatPenalty: model.recommendedSettings.repeatPenalty === 1.1 ? 1.0 : model.recommendedSettings.repeatPenalty,
          },
        }));
      }
      this.initialized = true;
    } catch (error) {
      console.error('[CustomModelService] Failed to load custom models:', error);
      this.customModels = [];
      this.initialized = true;
    }
  }

  private async save(): Promise<void> {
    try {
      await AsyncStorage.setItem(CUSTOM_MODELS_KEY, JSON.stringify(this.customModels));
      this.notifyListeners();
    } catch (error) {
      console.error('[CustomModelService] Failed to save custom models:', error);
    }
  }

  private notifyListeners(): void {
    this.listeners.forEach(listener => listener([...this.customModels]));
  }

  subscribe(listener: (models: CustomModelConfig[]) => void): () => void {
    this.listeners.add(listener);
    listener([...this.customModels]);
    return () => this.listeners.delete(listener);
  }

  /**
   * Validate a GGUF URL
   */
  validateUrl(url: string): { valid: boolean; error?: string } {
    if (!url || !url.trim()) {
      return { valid: false, error: 'URL is required' };
    }

    const trimmedUrl = url.trim();

    // Must be HTTPS
    if (!trimmedUrl.startsWith('https://')) {
      return { valid: false, error: 'URL must use HTTPS' };
    }

    // Must end with .gguf (with optional query params)
    const urlWithoutParams = trimmedUrl.split('?')[0];
    if (!urlWithoutParams.toLowerCase().endsWith('.gguf')) {
      return { valid: false, error: 'URL must point to a .gguf file' };
    }

    // Basic URL validation
    try {
      new URL(trimmedUrl);
    } catch {
      return { valid: false, error: 'Invalid URL format' };
    }

    return { valid: true };
  }

  /**
   * Extract filename from URL
   */
  extractFilename(url: string): string {
    const urlWithoutParams = url.split('?')[0];
    const parts = urlWithoutParams.split('/');
    return parts[parts.length - 1] || 'custom-model.gguf';
  }

  /**
   * Build a collision-resistant on-device filename for model storage.
   * Using the raw remote filename can cause one custom model to overwrite another
   * when different URLs share the same basename.
   */
  buildStorageFilename(modelId: string, sourceFilename: string): string {
    return `${modelId}-${sourceFilename}`;
  }

  /**
   * Generate a unique ID for a custom model
   */
  generateModelId(name: string): string {
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const timestamp = Date.now().toString(36);
    return `custom-${base}-${timestamp}`;
  }

  /**
   * Fetch file size from URL using HEAD request
   */
  async fetchFileSize(url: string): Promise<number> {
    try {
      const response = await fetch(url, { method: 'HEAD' });
      const contentLength = response.headers.get('content-length');
      if (contentLength) {
        return parseInt(contentLength, 10);
      }
    } catch {
      // Failed to fetch file size
    }
    return 0;
  }

  /**
   * Add a new custom model
   */
  async addModel(params: {
    name: string;
    url: string;
    description?: string;
    sizeBytes?: number;
  }): Promise<{ success: boolean; model?: CustomModelConfig; error?: string }> {
    await this.initialize();

    const { name, url, description } = params;
    let { sizeBytes } = params;

    // Validate URL
    const validation = this.validateUrl(url);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    // Check for duplicate URL
    const existingByUrl = this.customModels.find(m => m.modelUrl === url.trim());
    if (existingByUrl) {
      return { success: false, error: 'A model with this URL already exists' };
    }

    // Fetch file size if not provided
    if (!sizeBytes) {
      sizeBytes = await this.fetchFileSize(url.trim());
    }

    const modelId = this.generateModelId(name);
    const filename = this.extractFilename(url);
    const storageFilename = this.buildStorageFilename(modelId, filename);

    const newModel: CustomModelConfig = {
      id: modelId,
      name: name.trim(),
      description: description?.trim() || 'Custom GGUF model',
      size: sizeBytes ? this.formatSize(sizeBytes) : 'Unknown',
      sizeBytes: sizeBytes || 0,
      modelUrl: url.trim(),
      modelFilename: storageFilename,
      hasVision: false, // Custom models don't support vision by default
      recommendedSettings: { ...DEFAULT_CUSTOM_MODEL_SETTINGS },
      systemPrompt: getSystemPrompt('default'),
      features: [], // No default features for generic custom models
      stopSequences: ['</s>', '<|im_end|>', '<|eot_id|>', '<|end|>'],
      toolFormat: 'text',
      isCustom: true,
      addedAt: Date.now(),
    };

    this.customModels.push(newModel);
    await this.save();

    return { success: true, model: newModel };
  }

  /**
   * Remove a custom model
   */
  async removeModel(modelId: string): Promise<boolean> {
    await this.initialize();

    const index = this.customModels.findIndex(m => m.id === modelId);
    if (index === -1) return false;

    this.customModels.splice(index, 1);
    await this.save();
    return true;
  }

  /**
   * Get all custom models
   */
  async getModels(): Promise<CustomModelConfig[]> {
    await this.initialize();
    return [...this.customModels];
  }

  /**
   * Get a specific custom model by ID
   */
  async getModelById(modelId: string): Promise<CustomModelConfig | undefined> {
    await this.initialize();
    return this.customModels.find(m => m.id === modelId);
  }

  /**
   * Check if a model ID is a custom model
   */
  isCustomModel(modelId: string): boolean {
    return modelId.startsWith('custom-');
  }

  /**
   * Format bytes to human-readable size
   */
  private formatSize(bytes: number): string {
    if (bytes === 0) return 'Unknown';
    const gb = bytes / (1024 * 1024 * 1024);
    if (gb >= 1) {
      return `${gb.toFixed(1)} GB`;
    }
    const mb = bytes / (1024 * 1024);
    return `${Math.round(mb)} MB`;
  }

  /**
   * Update model size after download completes
   */
  async updateModelSize(modelId: string, sizeBytes: number): Promise<void> {
    await this.initialize();

    const model = this.customModels.find(m => m.id === modelId);
    if (model) {
      model.sizeBytes = sizeBytes;
      model.size = this.formatSize(sizeBytes);
      await this.save();
    }
  }
}

export const customModelService = CustomModelService.getInstance();
