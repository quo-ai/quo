import { Message, AppSettings, StreamCallback, GenerationStats, NativeToolCall, ContextSummary } from '@/types/chat';
import { Platform } from 'react-native';
import { deleteAsync } from 'expo-file-system/legacy';
import { downloadWithValidation, fileHasValidSize } from './fileDownload';
import { ModelConfig, getModelById, getDefaultModel, DEFAULT_MODEL_ID } from '@/constants/models';
import { customModelService, CustomModelConfig } from './customModelService';
import { TOOL_DEFINITIONS } from './tools';
import { getBundledStarterSource, materializeBundledStarter, BundledStarterSource } from './bundledModel';
import { getModelPath, getModelTempPath, getMmprojPath, getMmprojMinValidBytes, getModelMinValidBytes, isModelFileValid } from './llm/paths';
import {
  stripReasoningTags,
  buildSystemContent,
  buildChatMessages,
} from './llm/prompt';
import { heuristicTokenEstimate, fitMessagesToContext } from './llm/tokens';
import { buildGenerationStats, mergeGenerationStats } from './llm/stats';
import { resolveCompletionParams } from './llm/completionParams';
import { buildInitParams } from './llm/initParams';
import {
  KEEP_RECENT_MESSAGES,
  COMPRESS_THRESHOLD_RATIO,
  SUMMARY_MAX_TOKENS,
  estimateLiveTokens,
  buildCompressionTranscript,
  fitTranscriptToBudget,
  buildSummaryInstruction,
  cleanSummaryText,
} from './llm/compression';

// Conditional import for llama.rn - only available on native platforms (iOS/Android)
let initLlama: typeof import('llama.rn').initLlama | null = null;
let loadLlamaModelInfo: typeof import('llama.rn').loadLlamaModelInfo | null = null;

type LlamaContext = import('llama.rn').LlamaContext;
type TokenData = import('llama.rn').TokenData;
type NativeCompletionResult = import('llama.rn').NativeCompletionResult;

if (Platform.OS !== 'web') {
  try {
    const llamaModule = require('llama.rn');
    initLlama = llamaModule.initLlama;
    loadLlamaModelInfo = llamaModule.loadLlamaModelInfo;
  } catch (e) {
    console.warn('llama.rn not available on this platform');
  }
}

export type ModelStatus = 'not_downloaded' | 'downloading' | 'downloaded' | 'loading' | 'ready' | 'error';

export interface GenerateOptions {
  contextSummary?: string | null;
  recallContext?: string | null;
}

export interface GenerateResult {
  text: string;
  stats?: GenerationStats;
  nativeToolCalls?: NativeToolCall[];
  continuationRounds?: number;
  /** The native context died mid-generation and has been dropped. */
  modelUnloaded?: boolean;
}

/**
 * The reply as the UI stores and renders it: reasoning in a <think> block
 * (left open while streaming until the answer starts) followed by the answer.
 */
function composeReply(reasoning: string, content: string, streaming: boolean): string {
  if (!reasoning) return content;
  if (streaming && !content) return `<think>${reasoning}`;
  return `<think>${reasoning}</think>${content}`;
}

/**
 * Separator between a continuation round and the text before it.
 * stripReasoningTags trims, so restore the break the model emitted to keep a
 * continuation from jamming into the previous text.
 */
function roundSeparator(round: number, rawRoundText: string, visibleRoundText: string): string {
  if (round === 0 || !visibleRoundText) return '';
  const leadingWs = rawRoundText.match(/^\s+/)?.[0] ?? '';
  return leadingWs.includes('\n') ? '\n\n' : leadingWs ? ' ' : '';
}

// Memory instructions are now handled via tool calling - no text-based parsing needed

export interface ModelState {
  status: ModelStatus;
  downloadProgress: number;
  loadProgress: number;
  error?: string;
}

export interface DeviceInfo {
  gpu: boolean;
  reasonNoGPU: string;
  devices: string[];
  androidLib?: string;
}

export class LLMService {
  private static instance: LLMService;
  private context: LlamaContext | null = null;
  private isModelLoaded = false;
  private isLoading = false;
  private stopRequested = false; // Aborts a background compression pass
  private isCompleting = false; // Guards against stop-during-completion race (SIGSEGV)
  private isGeneratingResponse = false; // True for the whole span of a user generation
  // Bumped by stopGeneration/unloadModel. A generation remembers the epoch it
  // started in and treats any change as a sticky abort — including a stop
  // that lands before its native completion has begun.
  private generationEpoch = 0;
  private activeGeneration: Promise<unknown> | null = null;
  private isSummarizing = false; // True while a background context-compression pass runs
  private speculativeEnabled = false; // Draft-model speculative decoding (applies on next load)
  private isMultimodalEnabled = false;
  private visionSupported = false;
  private currentModelId: string = DEFAULT_MODEL_ID;
  private currentModel: ModelConfig = getDefaultModel();
  private loadedModelId: string | null = null;
  private loadedFromAsset = false; // Model runs straight from the bundled copy (asset pack / app bundle, no copy)
  private deviceInfo: DeviceInfo | null = null;

  private constructor() {}

  static getInstance(): LLMService {
    if (!LLMService.instance) {
      LLMService.instance = new LLMService();
    }
    return LLMService.instance;
  }

  getCurrentModel(): ModelConfig {
    return this.currentModel;
  }

  getCurrentModelId(): string {
    return this.currentModelId;
  }

  setCurrentModel(modelId: string): void {
    const model = getModelById(modelId);
    if (model) {
      this.currentModelId = modelId;
      this.currentModel = model;
    }
  }

  /** Toggle draft-model speculative decoding. Applies on the next model load. */
  setSpeculativeEnabled(enabled: boolean): void {
    this.speculativeEnabled = enabled;
  }

  async setCurrentModelAsync(modelId: string): Promise<boolean> {
    // Try built-in models first
    const builtIn = getModelById(modelId);
    if (builtIn) {
      this.currentModelId = modelId;
      this.currentModel = builtIn;
      return true;
    }

    // Try custom models
    if (customModelService.isCustomModel(modelId)) {
      const custom = await customModelService.getModelById(modelId);
      if (custom) {
        this.currentModelId = modelId;
        this.currentModel = custom;
        return true;
      }
    }

    return false;
  }

  private getModelPath(model?: ModelConfig): string {
    return getModelPath(model || this.currentModel);
  }

  private getModelTempPath(model?: ModelConfig): string {
    return getModelTempPath(model || this.currentModel);
  }

  private getMmprojPath(model?: { mmprojFilename?: string }): string {
    return getMmprojPath(model || this.currentModel);
  }

  /**
   * Trim conversation history to fit the active model context window and
   * compute a safe generation cap. This keeps the newest user turn while
   * aggressively shedding old history instead of relying on native ctx_shift.
   */
  private async fitMessagesToContext(
    messages: Message[],
    systemContent: string,
    requestedOutputTokens: number,
  ): Promise<{ messages: Message[]; maxTokens: number }> {
    const contextSize = this.currentModel.recommendedSettings.contextSize || 8192;
    return fitMessagesToContext(
      messages,
      systemContent,
      requestedOutputTokens,
      contextSize,
      this.preservesReasoningHistory(),
      (text) => this.estimateTokens(text),
    );
  }

  async checkMmprojExists(): Promise<boolean> {
    // Real file checks on native platforms; web has no filesystem.
    if (Platform.OS === 'web') return false;

    try {
      // Same validity policy as downloadMmproj — a truncated leftover must
      // not gate vision init as "present".
      return await fileHasValidSize(
        this.getMmprojPath(),
        getMmprojMinValidBytes(this.currentModel),
      );
    } catch {
      return false;
    }
  }

  getIsVisionSupported(): boolean {
    return this.visionSupported;
  }

  getDeviceInfo(): DeviceInfo | null {
    return this.deviceInfo;
  }

  // Check if the current model has vision capability (even if not fully initialized)
  getModelHasVision(): boolean {
    return this.currentModel.hasVision;
  }

  // Try to initialize multimodal after model is loaded (if mmproj exists)
  async tryInitializeMultimodal(): Promise<boolean> {
    if (!this.context || !this.currentModel.hasVision) {
      return false;
    }

    const mmprojExists = await this.checkMmprojExists();
    if (!mmprojExists) {
      return false;
    }

    try {
      const mmprojPath = this.getMmprojPath();
      const success = await this.context.initMultimodal({
        path: mmprojPath,
        use_gpu: true,
        image_max_tokens: 512,
      });
      if (success) {
        this.isMultimodalEnabled = await this.context.isMultimodalEnabled();
        if (this.isMultimodalEnabled) {
          const support = await this.context.getMultimodalSupport();
          this.visionSupported = support?.vision || false;
          return this.visionSupported;
        }
      }
    } catch {
      // Multimodal init failed
    }
    return false;
  }

  private async modelFileExists(model?: ModelConfig | CustomModelConfig): Promise<boolean> {
    // Shared validity policy (>=95% of catalog size, GGUF magic for custom
    // models of unknown size): a truncated file must never reach initLlama.
    return isModelFileValid(model || this.currentModel);
  }

  async checkModelExists(modelId?: string): Promise<boolean> {
    // Web fakes availability for the demo shell; iOS and Android use real
    // file checks so the download/load flow behaves identically on both.
    if (Platform.OS === 'web') return true;

    let model: ModelConfig | CustomModelConfig | undefined;
    if (modelId) {
      model = getModelById(modelId);
      // Check custom models if not found
      if (!model && customModelService.isCustomModel(modelId)) {
        model = await customModelService.getModelById(modelId);
      }
    } else {
      model = this.currentModel;
    }
    if (!model) return false;

    if (await this.modelFileExists(model)) return true;

    // The starter can also run straight from the bundled copy (asset pack).
    if (model.id === DEFAULT_MODEL_ID) {
      return (await getBundledStarterSource()) !== null;
    }
    return false;
  }

  async getModelState(): Promise<ModelState> {
    if (Platform.OS === 'web') {
      return { status: 'ready', downloadProgress: 100, loadProgress: 100 };
    }

    if (this.isModelLoaded) {
      return { status: 'ready', downloadProgress: 100, loadProgress: 100 };
    }

    if (this.isLoading) {
      return { status: 'loading', downloadProgress: 100, loadProgress: 0 };
    }

    const exists = await this.checkModelExists();
    if (exists) {
      return { status: 'downloaded', downloadProgress: 100, loadProgress: 0 };
    }

    return { status: 'not_downloaded', downloadProgress: 0, loadProgress: 0 };
  }

  // Note: Model downloads are now handled by downloadService

  async deleteModel(): Promise<void> {
    await this.unloadModel();

    try {
      const modelPath = this.getModelPath();
      const tempPath = this.getModelTempPath();
      const mmprojPath = this.getMmprojPath();

      await deleteAsync(modelPath, { idempotent: true });
      await deleteAsync(tempPath, { idempotent: true });
      if (mmprojPath) {
        await deleteAsync(mmprojPath, { idempotent: true });
      }

    } catch {
      // Ignore delete errors
    }
  }

  async deleteModelById(modelId: string): Promise<void> {
    // If this model is currently loaded, unload it first
    if (this.loadedModelId === modelId && this.context) {
      await this.unloadModel();
    }

    // Resolve the model config
    let model: ModelConfig | undefined = getModelById(modelId);
    if (!model) {
      const custom = await customModelService.getModelById(modelId);
      if (custom) model = custom as unknown as ModelConfig;
    }
    if (!model) return;

    try {
      const modelPath = this.getModelPath(model);
      const tempPath = this.getModelTempPath(model);
      const mmprojPath = this.getMmprojPath(model);

      await deleteAsync(modelPath, { idempotent: true });
      await deleteAsync(tempPath, { idempotent: true });
      if (mmprojPath) {
        await deleteAsync(mmprojPath, { idempotent: true });
      }
    } catch {
      // Ignore delete errors
    }
  }

  async downloadMmproj(
    onProgress?: (progress: number) => void,
    model?: ModelConfig | CustomModelConfig
  ): Promise<boolean> {
    const targetModel = model || this.currentModel;

    if (!targetModel.hasVision || !targetModel.mmprojUrl) {
      return false;
    }

    try {
      // Truncated downloads must not pass as valid; the floor comes from the
      // same policy checkMmprojExists uses (getMmprojMinValidBytes).
      return await downloadWithValidation({
        url: targetModel.mmprojUrl,
        destPath: this.getMmprojPath(targetModel),
        expectedBytes: targetModel.mmprojSizeBytes || 500000000,
        minValidBytes: getMmprojMinValidBytes(targetModel),
        onProgress,
      });
    } catch (error) {
      console.error('Mmproj download error:', error);
      return false;
    }
  }

  /** Whether this model's MTP speed file (Speed Boost) is on disk and valid. */
  async hasMtpDraft(model: ModelConfig): Promise<boolean> {
    if (!model.mtpDraft) return false;
    return isModelFileValid({ modelFilename: model.mtpDraft.filename, sizeBytes: model.mtpDraft.sizeBytes });
  }

  /** Download a model's MTP speed file; size-validated like every model file. */
  async downloadMtpDraft(model: ModelConfig, onProgress?: (progress: number) => void): Promise<boolean> {
    if (!model.mtpDraft) return false;
    const draft = { modelFilename: model.mtpDraft.filename, sizeBytes: model.mtpDraft.sizeBytes };
    try {
      return await downloadWithValidation({
        url: model.mtpDraft.url,
        destPath: getModelPath(draft),
        expectedBytes: draft.sizeBytes,
        minValidBytes: getModelMinValidBytes(draft),
        onProgress,
      });
    } catch (error) {
      console.error('MTP draft download error:', error);
      return false;
    }
  }

  async loadModel(onProgress?: (progress: number) => void): Promise<boolean> {
    // If the same model is already loaded, return true
    if (this.isModelLoaded && this.context && this.loadedModelId === this.currentModelId) {
      onProgress?.(100);
      return true;
    }

    if (this.isLoading) return false;
    // Claim the load synchronously so a concurrent call can't slip past the
    // guard during the awaits below, and pin the target: the selection may
    // change mid-load, and the context must be labelled with what it loaded.
    this.isLoading = true;
    const targetId = this.currentModelId;
    const target = this.currentModel;
    try {
      return await this.loadPinnedModel(targetId, target, onProgress);
    } finally {
      this.isLoading = false;
    }
  }

  private async loadPinnedModel(
    targetId: string,
    target: ModelConfig | CustomModelConfig,
    onProgress?: (progress: number) => void,
  ): Promise<boolean> {
    // Web has no native inference — fake a loaded model for the demo shell.
    // iOS and Android both run the real llama.rn load path.
    if (Platform.OS === 'web') {
      onProgress?.(100);
      this.isModelLoaded = true;
      this.loadedModelId = targetId;
      return true;
    }

    // If a different model is loaded, unload it first
    if (this.context && this.loadedModelId !== targetId) {
      await this.unloadModel();
    }

    const fileExists = await this.modelFileExists(target);
    let bundledSource: BundledStarterSource | null = null;
    if (!fileExists) {
      // The starter can ship with the app — Android: fast-follow asset pack
      // (a real file, loaded in place) or APK assets; iOS: bundle resource.
      // Asset-relative sources use is_model_asset, which llama.rn 0.12.x
      // implements for iOS only (Android throws and we fall back to a copy
      // below); if a future llama.rn adds it this path activates on its own —
      // watch the loaded_from_asset analytics.
      if (targetId === DEFAULT_MODEL_ID) {
        bundledSource = await getBundledStarterSource();
      }
      if (!bundledSource) return false;
    }

    onProgress?.(0);

    try {
      const onInitProgress = (progress: number) => {
        const normalizedProgress = progress > 1 ? progress : progress * 100;
        onProgress?.(Math.min(Math.round(normalizedProgress), 100));
      };

      let loadedFromBundle = Boolean(bundledSource);
      let contextResult: LlamaContext;
      try {
        contextResult = await initLlama!(
          await this.buildInitParams(
            bundledSource?.path ?? this.getModelPath(target),
            bundledSource?.isAsset ?? false,
            targetId,
            target,
          ),
          onInitProgress,
        );
      } catch (initError) {
        if (!bundledSource?.isAsset) throw initError;
        if (__DEV__) {
          console.warn(
            '[LLM] Asset-direct load failed, falling back to copy:',
            initError instanceof Error ? initError.message : String(initError),
          );
        }
        // Asset-direct loading is not supported here — materialize the copy
        // once and load from the file as before.
        const materialized = await materializeBundledStarter();
        if (!materialized) throw initError;
        loadedFromBundle = false;
        contextResult = await initLlama!(await this.buildInitParams(this.getModelPath(target), false, targetId, target), onInitProgress);
      }
      this.loadedFromAsset = loadedFromBundle;

      this.context = contextResult;
      this.deviceInfo = {
        gpu: contextResult.gpu,
        reasonNoGPU: contextResult.reasonNoGPU,
        devices: contextResult.devices || [],
        androidLib: contextResult.androidLib,
      };
      if (__DEV__) {
        console.log(`[LLM] GPU: ${contextResult.gpu}, devices: ${(contextResult.devices || []).join(', ') || 'none'}${contextResult.reasonNoGPU ? `, reason no GPU: ${contextResult.reasonNoGPU}` : ''}`);
      }

      // Initialize multimodal/vision if available
      this.isModelLoaded = true;
      this.loadedModelId = targetId;

      if (target.hasVision && this.context && targetId === this.currentModelId) {
        await this.tryInitializeMultimodal();
      }

      onProgress?.(100);
      return true;
    } catch (error) {
      console.error('Failed to load model:', error);
      onProgress?.(0);
      return false;
    }
  }

  getIsModelLoaded(): boolean {
    return this.isModelLoaded;
  }

  /** True when the current model runs directly from the app's asset pack. */
  wasLoadedFromAsset(): boolean {
    return this.loadedFromAsset;
  }

  /**
   * Assemble initLlama params for the current model. `modelSource` is either
   * a file path or an AssetManager-relative path (with isModelAsset true).
   */
  private async buildInitParams(
    modelSource: string,
    isModelAsset: boolean,
    modelId: string,
    model: ModelConfig | CustomModelConfig,
  ) {
    return buildInitParams(
      modelSource,
      isModelAsset,
      model,
      modelId,
      this.speculativeEnabled,
      (model) => this.modelFileExists(model),
    );
  }

  /**
   * Estimate the number of tokens in a text string using the loaded model's
   * tokenizer. Falls back to a rough heuristic (1 token ≈ 4 chars) when the
   * native context is not available.
   */
  // Token-count LRU: identical texts (system prompt, unchanged history
  // messages) get re-tokenized on every generation round, continuation and
  // idle compression pass, and each native tokenize is a bridge round-trip.
  // Cleared whenever the loaded model changes — counts are
  // tokenizer-specific.
  private tokenCountCache = new Map<string, number>();
  private static readonly TOKEN_CACHE_MAX = 1024;

  private clearTokenCache(): void {
    this.tokenCountCache.clear();
  }

  async estimateTokens(text: string): Promise<number> {
    if (!this.context || !this.isModelLoaded) {
      return heuristicTokenEstimate(text);
    }
    const cached = this.tokenCountCache.get(text);
    if (cached !== undefined) {
      // Refresh recency (Map preserves insertion order).
      this.tokenCountCache.delete(text);
      this.tokenCountCache.set(text, cached);
      return cached;
    }
    try {
      const tokens = await this.context.tokenize(text);
      if (!Array.isArray(tokens)) return heuristicTokenEstimate(text);
      this.tokenCountCache.set(text, tokens.length);
      if (this.tokenCountCache.size > LLMService.TOKEN_CACHE_MAX) {
        const oldest = this.tokenCountCache.keys().next().value;
        if (oldest !== undefined) this.tokenCountCache.delete(oldest);
      }
      return tokens.length;
    } catch {
      return heuristicTokenEstimate(text);
    }
  }

  /**
   * Get the maximum number of tokens that can safely be used for document
   * content, reserving space for system prompt, conversation history, and
   * generation output.
   */
  getDocumentTokenBudget(historyTokens: number = 0): number {
    const contextSize = this.currentModel.recommendedSettings.contextSize || 8192;
    // Reserve specific space for system prompt (~500) and generation output (~1000)
    const fixedReserve = 1500;
    const dynamicBudget = contextSize - historyTokens - fixedReserve;
    // Even if history is massive, try to guarantee at least 30% of the context size for the document
    return Math.max(dynamicBudget, Math.floor(contextSize * 0.3));
  }

  getLoadedModelId(): string | null {
    return this.loadedModelId;
  }

  isModelCurrentlyLoaded(modelId: string): boolean {
    return this.isModelLoaded && this.loadedModelId === modelId;
  }

  getIsLoading(): boolean {
    return this.isLoading;
  }

  // Capability lookups come from the model catalog (constants/models.ts)
  // rather than id-substring checks, so custom models never inherit
  // family behavior from their name.
  private preservesReasoningHistory(): boolean {
    return Boolean((this.currentModel as ModelConfig).preservesReasoningHistory);
  }

  private emitsInternalReasoningTags(): boolean {
    return Boolean((this.currentModel as ModelConfig).emitsInternalReasoningTags);
  }

  /**
   * Strip model-specific internal reasoning tags while preserving <think> for the UI.
   */
  private stripReasoningTags(text: string): string {
    return stripReasoningTags(text, this.emitsInternalReasoningTags());
  }

  /**
   * Run a user generation. `onStream` receives the full visible text so far
   * (not a delta) on every update, then ('', true) once at the end.
   */
  generate(
    messages: Message[],
    settings: AppSettings,
    onStream: StreamCallback,
    options?: GenerateOptions,
  ): Promise<GenerateResult> {
    // Native completions must never overlap: abort any generation still in
    // flight and wait for it to finish before starting this one.
    const previous = this.activeGeneration;
    if (previous) {
      this.generationEpoch++;
      void this.stopNativeCompletion();
    }
    const epoch = this.generationEpoch;
    const run = (async () => {
      if (previous) {
        await previous.catch(() => {});
        await new Promise(resolve => setTimeout(resolve, 150));
      }
      return this.runGeneration(messages, settings, onStream, options, epoch);
    })();
    this.activeGeneration = run;
    void run.catch(() => {}).finally(() => {
      if (this.activeGeneration === run) this.activeGeneration = null;
    });
    return run;
  }

  private async runGeneration(
    messages: Message[],
    settings: AppSettings,
    onStream: StreamCallback,
    options: GenerateOptions | undefined,
    epoch: number,
  ): Promise<GenerateResult> {
    const startTime = Date.now();
    const aborted = () => this.generationEpoch !== epoch;

    if (!this.context || !this.isModelLoaded) {
      onStream('Model is not loaded. Please wait for the model to load.', true);
      return { text: 'Model is not loaded. Please wait for the model to load.' };
    }

    // A user generation owns the native context — abort any background
    // context-compression pass before proceeding.
    this.isGeneratingResponse = true;
    if (this.isSummarizing) {
      await this.cancelSummarization();
    }

    // Use the multimodal path when images are present and the model can accept
    // them; otherwise images degrade to a text placeholder.
    const hasImages = messages.some(m => m.image?.base64 || m.image?.uri);
    let useVision = false;
    if (hasImages) {
      if (!this.isMultimodalEnabled && this.currentModel.hasVision) {
        await this.tryInitializeMultimodal();
      }
      useVision = this.isMultimodalEnabled && this.visionSupported;
    }

    // A single completion pass is capped at n_predict tokens. When the model
    // hits that cap mid-answer (stopped_limit) we transparently ask it to
    // continue, streaming into the same response, so long answers finish
    // instead of cutting off mid-sentence.
    const MAX_CONTINUATION_ROUNDS = 3;
    let combinedVisible = '';
    let combinedStats: GenerationStats | undefined;
    let nativeToolCalls: NativeToolCall[] | undefined;

    try {
      const params = resolveCompletionParams(this.currentModel, settings);
      const useNativeTools = (this.currentModel as ModelConfig).toolFormat === 'native';
      const systemContent = buildSystemContent(
        this.currentModel.systemPrompt,
        options?.contextSummary,
        options?.recallContext,
      );
      const preserveReasoning = this.preservesReasoningHistory();

      let workingMessages = messages;
      let continuationAssistant: Message | null = null;
      let round = 0;

      while (true) {
        const fittedContext = await this.fitMessagesToContext(workingMessages, systemContent, params.maxTokens);

        // If the partial answer no longer fits the context window there is no
        // meaningful way to continue it — return what we have.
        if (continuationAssistant && !fittedContext.messages.includes(continuationAssistant)) {
          break;
        }

        // A stop that arrived during the awaits above must win before native
        // work starts; nothing between here and completion() yields.
        if (aborted()) break;

        const chatMessages = buildChatMessages(fittedContext.messages, systemContent, useVision, preserveReasoning);
        // Only let the model think on the first pass; continuations must
        // resume the visible answer, not open a new reasoning block mid-text.
        const isThinkingRound = params.isThinkingMode && round === 0;
        // Reasoning checkpoints think on every round, so always split their
        // reasoning out; hybrid models only reason on the first round.
        const parseReasoning = isThinkingRound || Boolean((this.currentModel as ModelConfig).alwaysThinks);

        // llama.rn re-parses the whole output on every token: when parsing is
        // active, token.content / token.reasoning_content are the accumulated
        // reply and reasoning so far (not deltas), with tool-call markup
        // removed. rawText is the fallback when a template has no parser.
        let rawText = '';
        let parsedContent = '';
        let parsedReasoning = '';
        let parsedSeen = false;
        let visibleResponse = '';
        const previousRoundsVisible = combinedVisible;
        const roundIndex = round;

        let result: NativeCompletionResult;
        try {
          this.isCompleting = true;
          result = await this.context!.completion(
            {
              messages: chatMessages,
              n_predict: fittedContext.maxTokens,
              temperature: params.temperature,
              top_p: params.topP,
              top_k: params.topK,
              min_p: params.minP,
              penalty_repeat: params.repeatPenalty,
              penalty_last_n: params.penaltyLastN,
              penalty_present: params.presencePenalty,
              penalty_freq: 0.0,
              stop: this.currentModel.stopSequences,
              seed: -1,
              jinja: true,
              ...(useNativeTools ? { tools: TOOL_DEFINITIONS, tool_choice: 'auto' } : {}),
              // DRY: penalises verbatim repeated sequences (loops) without
              // the side effects of a repeat penalty on lists/code. Values
              // are the DRY author's recommended defaults.
              dry_multiplier: 0.8,
              dry_base: 1.75,
              dry_allowed_length: 2,
              enable_thinking: isThinkingRound,
              reasoning_format: parseReasoning ? 'deepseek' : 'none',
              ...(parseReasoning
                ? {
                    thinking_budget_tokens: params.thinkingBudget,
                    thinking_budget_message: 'I have enough to answer now.',
                  }
                : {}),
            },
            // llama.rn ignores this callback's return value; native work is
            // stopped via stopCompletion() in stopGeneration/unloadModel.
            (token: TokenData) => {
              if (aborted()) return;
              rawText += token.token;
              if (token.content !== undefined || token.reasoning_content !== undefined) {
                parsedSeen = true;
                parsedContent = token.content ?? '';
                parsedReasoning = token.reasoning_content ?? '';
              }
              const streamText = composeReply(
                parsedSeen ? parsedReasoning : '',
                parsedSeen ? parsedContent : rawText,
                true,
              );
              const cleaned = this.stripReasoningTags(streamText);
              if (cleaned !== visibleResponse) {
                visibleResponse = cleaned;
                onStream(previousRoundsVisible + roundSeparator(roundIndex, rawText, cleaned) + cleaned, false);
              }
            }
          );
        } catch (completionError: any) {
          const errorMsg = completionError?.message || String(completionError);
          if (!useVision && (errorMsg.includes('Exception in HostFunction') || errorMsg.includes('unknown'))) {
            console.error('Native context error - context may be in invalid state after stop');
            onStream('', true);
            throw new Error('Generation was interrupted. Please try again.');
          }
          throw completionError;
        } finally {
          this.isCompleting = false;
        }

        // Prefer the final parse; an interrupted run may only have partials.
        const finalReasoning = result.reasoning_content ?? (parsedSeen ? parsedReasoning : '');
        const finalContent = result.content ?? (parsedSeen ? parsedContent : (rawText || result.text || ''));
        const roundText = composeReply(finalReasoning, finalContent, false);
        const roundVisible = this.stripReasoningTags(roundText);
        combinedVisible += roundSeparator(round, rawText || roundText, roundVisible) + roundVisible;

        const roundStats = buildGenerationStats(result, startTime, params.contextSize);
        if (!combinedStats) {
          combinedStats = roundStats;
        } else {
          combinedStats = mergeGenerationStats(combinedStats, roundStats);
        }

        nativeToolCalls = result.tool_calls?.length ? result.tool_calls as NativeToolCall[] : undefined;

        const hitTokenLimit = Boolean(result.stopped_limit) && !result.interrupted && !aborted();
        if (!hitTokenLimit || nativeToolCalls || !combinedVisible.trim() || round >= MAX_CONTINUATION_ROUNDS) {
          break;
        }

        round++;
        continuationAssistant = {
          id: `continuation-partial-${round}`,
          role: 'assistant',
          content: combinedVisible,
          timestamp: Date.now(),
        };
        workingMessages = [
          ...messages,
          continuationAssistant,
          {
            id: `continuation-request-${round}`,
            role: 'user',
            content: 'Your previous message was cut off before it was finished. Continue it from exactly where it stopped. Your reply is appended directly to the cut-off text, so do not repeat anything, do not summarise, and do not add a preamble — just carry on.',
            timestamp: Date.now(),
          },
        ];
      }

      onStream('', true);

      return {
        text: combinedVisible,
        stats: combinedStats,
        nativeToolCalls,
        continuationRounds: round,
      };
    } catch (error: any) {
      const errorMessage = error?.message || String(error);

      if (errorMessage.includes('Terminated') || errorMessage.includes('ThreadPoolExecutor')) {
        console.warn('Thread pool terminated - model context may be invalid');
        const deadContext = this.context;
        this.isModelLoaded = false;
        this.loadedModelId = null;
        this.context = null;
        this.isMultimodalEnabled = false;
        // Best-effort: free the native memory of the broken context.
        void deadContext?.release().catch(() => {});
        onStream('', true);
        // Keep whatever already streamed; the caller marks the model unloaded.
        return { text: combinedVisible, stats: combinedStats, nativeToolCalls, modelUnloaded: true };
      }

      // Whatever streamed before the error is already on screen — return it
      // rather than discarding the partial answer.
      if (combinedVisible.trim()) {
        console.error('Generation error after partial response:', error);
        onStream('', true);
        return { text: combinedVisible, stats: combinedStats, nativeToolCalls };
      }

      // If the multimodal path failed before producing anything, retry once
      // as text-only with the images replaced by a placeholder.
      if (useVision && !aborted()) {
        const textOnlyMessages = messages.map(m => ({
          ...m,
          image: undefined,
          content: m.image && !m.content
            ? `[Image was shared but vision processing failed]`
            : m.content,
        }));
        // Awaited so the finally below runs after the retry, not before it.
        return await this.runGeneration(textOnlyMessages, settings, onStream, options, epoch);
      }

      console.error('Generation error:', error);
      onStream('', true);
      throw error;
    } finally {
      this.isGeneratingResponse = false;
    }
  }

  async clearCache(): Promise<void> {
    // Clearing the KV cache under a running completion races the decoder;
    // the next generation re-evaluates its prompt anyway.
    if (!this.context || this.isCompleting || this.isGeneratingResponse) return;
    try {
      await this.context.clearCache(false);
    } catch {
      // Non-fatal if cache clear fails
    }
  }

  /**
   * Abort the in-flight user generation (if any) and resolve once it has
   * fully finished, so a following generate()/release() never overlaps it.
   */
  async stopGeneration(): Promise<void> {
    this.generationEpoch++;
    const pending = this.activeGeneration;
    await this.stopNativeCompletion();
    if (!pending) return;

    await Promise.race([
      pending.catch(() => {}),
      new Promise(resolve => setTimeout(resolve, 5000)),
    ]);
    // Short settle window so the C++ side can tear down its thread-pool work
    // items before the next completion starts.
    await new Promise(resolve => setTimeout(resolve, 150));
  }

  private async stopNativeCompletion(): Promise<void> {
    // Only call stopCompletion while the native context is actually completing.
    // Calling it outside of an active completion can trigger a use-after-free
    // SIGSEGV inside librnllama's endCompletion() on some devices.
    if (this.context && this.isCompleting) {
      try {
        await this.context.stopCompletion();
      } catch {
        // Ignore errors if completion already stopped
      }
    }
  }

  /**
   * Abort a background context-compression pass so a user generation can take
   * over the native context. No-op when nothing is being summarized.
   */
  async cancelSummarization(): Promise<void> {
    if (!this.isSummarizing) return;

    this.stopRequested = true;
    if (this.context && this.isCompleting) {
      try {
        await this.context.stopCompletion();
      } catch {
        // Completion may already have stopped
      }
    }

    // Wait for the summarization completion to wind down (max ~3s), then give
    // the native side a short settle window before a new completion starts.
    for (let i = 0; i < 30 && this.isSummarizing; i++) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    await new Promise(resolve => setTimeout(resolve, 300));

    this.stopRequested = false;
  }

  /**
   * Fold older conversation messages into a rolling summary using the loaded
   * model, so long conversations keep their early content as a digest instead
   * of losing it to context trimming. Returns the updated summary, or null
   * when compression is not needed or could not run.
   *
   * Designed to run opportunistically while the app is idle; a user
   * generation aborts it via cancelSummarization().
   */
  async compressConversationContext(
    messages: Message[],
    existing: ContextSummary | null,
  ): Promise<ContextSummary | null> {
    if (!this.context || !this.isModelLoaded || this.isGeneratingResponse || this.isCompleting || this.isSummarizing) {
      return null;
    }

    const contextSize = this.currentModel.recommendedSettings.contextSize || 8192;
    const covered = Math.min(existing?.coversMessageCount ?? 0, messages.length);

    // Always keep a live tail of recent messages out of the summary.
    const candidateEnd = messages.length - KEEP_RECENT_MESSAGES;
    if (candidateEnd <= covered) return null;

    // Only compress once the live history approaches the context budget —
    // each pass costs battery and invalidates the KV prefix cache.
    const liveTokens = await estimateLiveTokens(
      messages,
      covered,
      existing?.text,
      (text) => this.estimateTokens(text),
    );
    if (liveTokens < contextSize * COMPRESS_THRESHOLD_RATIO) return null;

    // Plain-text transcript of the messages being folded into the summary.
    let transcript = buildCompressionTranscript(messages, covered, candidateEnd);
    if (!transcript) return null;

    // Keep the summarization prompt itself within the context window,
    // preferring the newest part of the block when it is too large.
    transcript = await fitTranscriptToBudget(transcript, contextSize, (text) => this.estimateTokens(text));

    const instruction = buildSummaryInstruction(existing?.text, transcript);

    // Re-check after the awaits above: a user generation may have started in
    // the meantime and owns the native context. This check is synchronous
    // with setting the flags below, so the two passes cannot interleave.
    if (this.isGeneratingResponse || this.isCompleting) return null;

    try {
      this.isSummarizing = true;
      this.isCompleting = true;

      const result = await this.context.completion(
        {
          messages: [
            { role: 'system', content: 'You summarize conversations accurately and concisely. Reply with only the summary text.' },
            { role: 'user', content: instruction },
          ],
          n_predict: SUMMARY_MAX_TOKENS,
          temperature: 0.3,
          top_p: 0.9,
          stop: this.currentModel.stopSequences,
          enable_thinking: false,
          reasoning_format: 'none',
        },
        () => !this.stopRequested,
      );

      if (result.interrupted || this.stopRequested) return null;

      const text = cleanSummaryText(result.text || result.content || '', this.emitsInternalReasoningTags());
      if (!text) return null;

      return { text, coversMessageCount: candidateEnd, updatedAt: Date.now() };
    } catch {
      // Compression is best-effort; context trimming remains the fallback.
      return null;
    } finally {
      this.isCompleting = false;
      this.isSummarizing = false;
    }
  }

  async unloadModel(): Promise<void> {
    // Stop any user generation or compression pass and wait for the native
    // completion to finish before releasing the context. Releasing
    // mid-completion causes a use-after-free SIGSEGV in the JSI lambda.
    await this.stopGeneration();
    if (this.isSummarizing) {
      await this.cancelSummarization();
    }
    for (let i = 0; i < 50 && this.isCompleting; i++) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (this.isCompleting) {
      // Still running after 5s: leaking the context beats crashing the app.
      console.warn('unloadModel: completion did not stop; skipping native release');
      this.context = null;
    }

    if (this.context) {
      if (this.isMultimodalEnabled) {
        try {
          await this.context.releaseMultimodal();
        } catch {
          // Non-fatal, continue with unload
        }
      }
      try {
        await this.context.release();
      } catch (e) {
        // Context may already be released
      }
      this.context = null;
    }
    this.isModelLoaded = false;
    // isLoading is owned by loadModel (which unloads mid-load); don't reset it.
    this.loadedModelId = null;
    this.loadedFromAsset = false;
    this.clearTokenCache();
    this.isMultimodalEnabled = false;
    this.visionSupported = false;
    this.deviceInfo = null;
  }

}

export const llmService = LLMService.getInstance();
