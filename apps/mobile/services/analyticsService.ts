import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { PREMIUM_PRICE_FALLBACK } from '@/constants/premium';
import { decideConsentRegion, getDeviceRegion, type ConsentRegionCheck } from '@/utils/analyticsConsent';

type AnalyticsPrimitive = string | number | boolean | null | undefined;
type AnalyticsItem = Record<string, AnalyticsPrimitive>;
type AnalyticsValue = AnalyticsPrimitive | AnalyticsItem[];
type AnalyticsParams = Record<string, AnalyticsValue>;
interface FirebaseModules {
  analytics: {
    logEvent: (name: string, params?: Record<string, unknown>) => Promise<void>;
    setAnalyticsCollectionEnabled: (enabled: boolean) => Promise<void>;
    setUserProperty: (name: string, value: string | null) => Promise<void>;
  };
  crashlytics: {
    log: (message: string) => void;
    recordError: (error: Error, jsErrorName?: string) => void;
    setCrashlyticsCollectionEnabled: (enabled: boolean) => Promise<void>;
  };
  remoteConfig: {
    setConfigSettings: (settings: { minimumFetchIntervalMillis: number; fetchTimeMillis: number }) => Promise<void>;
    setDefaults: (defaults: Record<string, string>) => Promise<null>;
    fetchAndActivate: () => Promise<boolean>;
    getValue: (key: string) => { asString: () => string };
  };
}

const REMOTE_CONFIG_DEFAULTS = {
  recommended_model_id: 'qwen35-0.8b',
  premium_price_fallback: PREMIUM_PRICE_FALLBACK,
  paywall_variant: 'default',
  onboarding_variant: 'starter_fast',
  premium_trigger_mode: 'locked_feature',
  first_run_model_choice_enabled: 'false',
  download_copy_variant: 'speed_clarity',
  first_run_task_order: 'ask,summarize,image,voice',
  minimum_answers_before_paywall: '1',
};

const ANALYTICS_ONCE_PREFIX = '@quo_analytics_once:';
// Explicit user choice: 'true' | 'false' (consent prompt or Settings toggle).
const ANALYTICS_ENABLED_KEY = '@quo_analytics_enabled';
// Cached region outcome: 'consent' (opt-in region) | 'notice' (opt-out).
const ANALYTICS_REGION_KEY = '@quo_analytics_region';
// Upper bound on the region check, whatever the resolver does.
const REGION_CHECK_TIMEOUT_MS = 6000;

type RegionResolver = () => Promise<ConsentRegionCheck>;

const deviceOnlyRegion: RegionResolver = async () => decideConsentRegion(null, getDeviceRegion());
const APP_VERSION = Constants.expoConfig?.version || 'unknown';

// Param keys whose values are free-form error text (may embed file paths,
// URLs, model/file names). They are reduced to a coarse category code.
const ERROR_PARAM_KEYS = new Set(['error', 'error_message', 'message']);

// Ordered: first match wins.
const ERROR_CATEGORIES: [string, RegExp][] = [
  ['cancelled', /cancel|abort/i],
  ['out_of_memory', /out of memory|\boom\b|memory|alloc/i],
  ['insufficient_storage', /no space|enospc|storage|disk full|quota/i],
  ['file_not_found', /enoent|not found|no such file|does not exist|missing/i],
  ['permission_denied', /permission|eacces|eperm|denied|unauthori[sz]ed|forbidden/i],
  ['timeout', /time(d)? ?out|etimedout/i],
  ['network', /network|connect|internet|offline|socket|dns|host|ssl|http|fetch/i],
  ['invalid_model', /gguf|magic|invalid model|unsupported|architecture|tensor|vocab|corrupt|truncat/i],
  ['context_overflow', /context|n_ctx|too long|too many tokens/i],
  ['already_in_progress', /in progress|already|busy|concurrent/i],
  ['not_initialized', /not (initiali[sz]ed|loaded|ready)|no model|unavailable/i],
  ['invalid_argument', /invalid|illegal|unexpected|parse|json|syntax/i],
];

/**
 * Turns a raw error string into a privacy-safe code. Strings that are
 * already developer-defined snake_case codes pass through; anything else is
 * stripped of URLs/paths/quoted text and mapped to a coarse category.
 */
export function sanitizeErrorCode(raw: unknown): string | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const text = String(raw).trim();
  if (/^[A-Za-z0-9_-]{1,64}$/.test(text)) {
    // e.g. 'load_returned_false', 'E_USER_CANCELLED', 'ENOENT'
    return text.toLowerCase();
  }
  const stripped = text
    .replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, ' ')
    .replace(/(?:[A-Za-z]:)?(?:[\\/][^\s\\/'"`]+)+[\\/]?/g, ' ')
    .replace(/(['"`]).*?\1/g, ' ');
  const match = ERROR_CATEGORIES.find(([, pattern]) => pattern.test(stripped));
  return match ? match[0] : 'other';
}

/** Custom model ids embed the user-typed name (`custom-<name>-<ts>`). */
export function sanitizeModelId(value: unknown): unknown {
  return typeof value === 'string' && value.startsWith('custom-') ? 'custom' : value;
}

function sanitizeValueForKey(key: string, value: AnalyticsValue): AnalyticsValue {
  if (key.endsWith('model_id')) return sanitizeModelId(value) as AnalyticsValue;
  if (ERROR_PARAM_KEYS.has(key)) return sanitizeErrorCode(value);
  return value;
}

function normalizeEventName(eventName: string): string {
  const normalized = eventName
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return /^[a-z]/.test(normalized) ? normalized : `app_${normalized || 'event'}`.slice(0, 40);
}

function sanitizeItemParams(item: AnalyticsItem): Record<string, string | number> {
  return Object.entries(item).reduce<Record<string, string | number>>((acc, [key, value]) => {
    const safeKey = key
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, '_')
      .slice(0, 40);
    if (!safeKey) return acc;

    const safeValue = normalizeParamValue(sanitizeValueForKey(safeKey, value));
    if (safeValue === undefined || Array.isArray(safeValue)) return acc;
    acc[safeKey] = safeValue;
    return acc;
  }, {});
}

function normalizeParamValue(value: AnalyticsValue): string | number | Record<string, string | number>[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') return value.slice(0, 100);
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (Array.isArray(value)) {
    const items = value
      .map(sanitizeItemParams)
      .filter(item => Object.keys(item).length > 0);
    return items.length > 0 ? items : undefined;
  }
  return value;
}

function normalizeFeature(featureName?: string | null): string {
  if (!featureName) return 'general';
  return featureName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'general';
}

function sanitizeParams(params: AnalyticsParams): Record<string, unknown> {
  return Object.entries({
    app_version: APP_VERSION,
    platform: Platform.OS,
    ...params,
  }).reduce<Record<string, unknown>>((acc, [key, value]) => {
    const safeKey = key
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, '_')
      .slice(0, 40);
    if (!safeKey) return acc;
    const safeValue = normalizeParamValue(sanitizeValueForKey(safeKey, value));
    if (safeValue === undefined) return acc;
    acc[safeKey] = safeValue;
    return acc;
  }, {});
}

class AnalyticsService {
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private readonly disabled = Platform.OS === 'web';
  private firebaseModules: FirebaseModules | null | undefined;
  // Collection is off until decided (firebase.json also keeps the native SDKs
  // off at launch). Decided by the user's explicit choice if they've made
  // one; otherwise by region: opt-in regions (EU/EEA) wait for the consent
  // prompt, everywhere else collects with the Settings opt-out. Errors
  // reported before the decision are held, so nothing leaves the device
  // before it's allowed to.
  private collectionEnabled = false;
  private decided = false;
  private consentPromptNeeded = false;
  private remoteConfigFetched = false;
  private regionResolver: RegionResolver = deviceOnlyRegion;
  private decisionPromise: Promise<void> | null = null;
  private earlyErrors: Array<[unknown, string | undefined]> = [];
  private enabledListeners = new Set<(enabled: boolean) => void>();
  private consentListeners = new Set<(needed: boolean) => void>();

  /**
   * Supplies the full region check (store country + device region). Set by
   * the root layout at module load, before anything tracks; without it the
   * device region alone decides.
   */
  setRegionResolver(resolver: RegionResolver): void {
    this.regionResolver = resolver;
  }

  private decide(): Promise<void> {
    if (!this.decisionPromise) this.decisionPromise = this.runDecision();
    return this.decisionPromise;
  }

  private async runDecision(): Promise<void> {
    try {
      const stored = await AsyncStorage.getItem(ANALYTICS_ENABLED_KEY);
      if (stored === 'true' || stored === 'false') {
        this.collectionEnabled = stored === 'true';
        return;
      }
      const requiresConsent = await this.resolveRequiresConsent();
      this.collectionEnabled = !requiresConsent;
      this.consentPromptNeeded = requiresConsent;
    } catch {
      // Storage unreadable: stay off rather than guess.
      this.collectionEnabled = false;
    } finally {
      this.decided = true;
      this.enabledListeners.forEach(listener => listener(this.collectionEnabled));
      this.consentListeners.forEach(listener => listener(this.consentPromptNeeded));
      const early = this.earlyErrors;
      this.earlyErrors = [];
      early.forEach(([error, context]) => this.recordError(error, context));
    }
  }

  private async resolveRequiresConsent(): Promise<boolean> {
    const cached = await AsyncStorage.getItem(ANALYTICS_REGION_KEY).catch(() => null);
    if (cached === 'consent' || cached === 'notice') return cached === 'consent';

    let timer: ReturnType<typeof setTimeout> | undefined;
    const fallback = new Promise<ConsentRegionCheck>(resolve => {
      timer = setTimeout(() => resolve(deviceOnlyRegion()), REGION_CHECK_TIMEOUT_MS);
    });
    const check = await Promise.race([
      this.regionResolver().catch(() => deviceOnlyRegion()),
      fallback,
    ]).finally(() => clearTimeout(timer));

    // Only cache a confident answer (e.g. not "store unreachable, device says
    // US"), so an offline first launch re-checks the store next time.
    if (check.definitive) {
      await AsyncStorage.setItem(ANALYTICS_REGION_KEY, check.requiresConsent ? 'consent' : 'notice')
        .catch(() => {});
    }
    return check.requiresConsent;
  }

  /** Whether the user allows anonymous analytics + crash reports. */
  async isAnalyticsEnabled(): Promise<boolean> {
    await this.decide();
    return this.collectionEnabled;
  }

  subscribeAnalyticsEnabled(listener: (enabled: boolean) => void): () => void {
    this.enabledListeners.add(listener);
    return () => this.enabledListeners.delete(listener);
  }

  /** True when the one-time consent prompt (opt-in regions) should show. */
  async isConsentPromptNeeded(): Promise<boolean> {
    await this.decide();
    return this.consentPromptNeeded;
  }

  subscribeConsentPrompt(listener: (needed: boolean) => void): () => void {
    this.consentListeners.add(listener);
    return () => this.consentListeners.delete(listener);
  }

  /**
   * Records the user's explicit choice (consent prompt or Settings toggle),
   * persists it, and applies it to analytics and Crashlytics.
   */
  async setAnalyticsEnabled(enabled: boolean): Promise<void> {
    // Settle any in-flight decision first so it can't overwrite this choice.
    await this.decide();
    this.collectionEnabled = enabled;
    this.enabledListeners.forEach(listener => listener(enabled));
    if (this.consentPromptNeeded) {
      this.consentPromptNeeded = false;
      this.consentListeners.forEach(listener => listener(false));
    }
    try {
      await AsyncStorage.setItem(ANALYTICS_ENABLED_KEY, enabled ? 'true' : 'false');
    } catch {
      // Preference is best-effort; in-memory flag still applies this session.
    }
    if (this.disabled) return;
    try {
      const firebase = this.getFirebaseModules();
      if (!firebase) return;
      await firebase.analytics.setAnalyticsCollectionEnabled(enabled);
      await firebase.crashlytics.setCrashlyticsCollectionEnabled(enabled);
      if (enabled) await this.fetchRemoteConfig(firebase);
    } catch {
      // Firebase may be unavailable; the in-memory flag still gates every call.
    }
  }

  private getFirebaseModules(): FirebaseModules | null {
    if (this.disabled) return null;
    if (this.firebaseModules !== undefined) return this.firebaseModules;

    // Modular API (namespaced API is deprecated and removed in the next
    // rnfirebase major). Instances are bound once into wrappers so call
    // sites stay simple and everything stays lazily required.
    try {
      const analyticsApi = require('@react-native-firebase/analytics');
      const crashlyticsApi = require('@react-native-firebase/crashlytics');
      const remoteConfigApi = require('@react-native-firebase/remote-config');
      const analytics = analyticsApi.getAnalytics();
      const crashlytics = crashlyticsApi.getCrashlytics();
      const remoteConfig = remoteConfigApi.getRemoteConfig();

      this.firebaseModules = {
        analytics: {
          logEvent: (name, params) => analyticsApi.logEvent(analytics, name, params),
          setAnalyticsCollectionEnabled: enabled =>
            analyticsApi.setAnalyticsCollectionEnabled(analytics, enabled),
          setUserProperty: (name, value) => analyticsApi.setUserProperty(analytics, name, value),
        },
        crashlytics: {
          log: message => crashlyticsApi.log(crashlytics, message),
          recordError: (error, jsErrorName) =>
            crashlyticsApi.recordError(crashlytics, error, jsErrorName),
          setCrashlyticsCollectionEnabled: enabled =>
            crashlyticsApi.setCrashlyticsCollectionEnabled(crashlytics, enabled),
        },
        remoteConfig: {
          setConfigSettings: settings => remoteConfigApi.setConfigSettings(remoteConfig, settings),
          setDefaults: defaults => remoteConfigApi.setDefaults(remoteConfig, defaults),
          fetchAndActivate: () => remoteConfigApi.fetchAndActivate(remoteConfig),
          getValue: key => remoteConfigApi.getValue(remoteConfig, key),
        },
      };
    } catch (error) {
      if (__DEV__) console.warn('[Analytics] Firebase modular init failed:', error);
      this.firebaseModules = null;
    }

    return this.firebaseModules;
  }

  async initialize(): Promise<void> {
    if (this.disabled || this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      try {
        await this.decide();
        const firebase = this.getFirebaseModules();
        if (!firebase) return;

        await firebase.analytics.setAnalyticsCollectionEnabled(this.collectionEnabled);
        await firebase.crashlytics.setCrashlyticsCollectionEnabled(this.collectionEnabled);
        await firebase.remoteConfig.setConfigSettings({
          minimumFetchIntervalMillis: __DEV__ ? 60_000 : 3_600_000,
          fetchTimeMillis: 10_000,
        });
        await firebase.remoteConfig.setDefaults(REMOTE_CONFIG_DEFAULTS);
        // Fetching contacts Firebase with an installation id, so it waits for
        // the same permission as analytics; until then local defaults apply.
        if (this.collectionEnabled) await this.fetchRemoteConfig(firebase);
      } catch {
        // Firebase may be unavailable until native config files are added.
      } finally {
        this.initialized = true;
        this.initPromise = null;
      }
    })();

    return this.initPromise;
  }

  private async fetchRemoteConfig(firebase: FirebaseModules): Promise<void> {
    if (this.remoteConfigFetched) return;
    this.remoteConfigFetched = true;
    try {
      await firebase.remoteConfig.fetchAndActivate();
    } catch {
      // Offline or unavailable: defaults stay in effect.
    }
  }

  async track(eventName: string, params: AnalyticsParams = {}): Promise<void> {
    if (this.disabled) return;

    try {
      await this.initialize();
      if (!this.collectionEnabled) return;
      const firebase = this.getFirebaseModules();
      if (!firebase) return;
      await firebase.analytics.logEvent(normalizeEventName(eventName), sanitizeParams(params));
    } catch (error) {
      // Analytics must never affect app behavior.
      if (__DEV__) console.warn('[Analytics] logEvent failed:', error);
    }
  }

  private async trackOnce(eventName: string, onceKey: string, params: AnalyticsParams = {}): Promise<void> {
    if (this.disabled) return;

    try {
      const key = `${ANALYTICS_ONCE_PREFIX}${onceKey}`;
      const existing = await AsyncStorage.getItem(key);
      if (existing) return;

      await AsyncStorage.setItem(key, String(Date.now()));
      await this.track(eventName, params);
    } catch {
      await this.track(eventName, params);
    }
  }

  async setUserProperty(name: string, value: AnalyticsValue): Promise<void> {
    if (this.disabled) return;

    try {
      await this.initialize();
      if (!this.collectionEnabled) return;
      const firebase = this.getFirebaseModules();
      if (!firebase) return;

      const safeName = name
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, '_')
        .slice(0, 24);
      if (!safeName) return;

      const safeValue = typeof value === 'boolean'
        ? (value ? 'true' : 'false')
        : normalizeParamValue(sanitizeValueForKey(safeName, value));
      if (Array.isArray(safeValue)) return;
      await firebase.analytics.setUserProperty(
        safeName,
        safeValue === undefined ? null : String(safeValue).slice(0, 36),
      );
    } catch {
      // User properties are useful, but not critical.
    }
  }

  async setUserProperties(properties: Record<string, AnalyticsValue>): Promise<void> {
    await Promise.all(
      Object.entries(properties).map(([key, value]) => this.setUserProperty(key, value)),
    );
  }

  recordError(error: unknown, context?: string): void {
    if (this.disabled) return;
    if (!this.decided) {
      if (this.earlyErrors.length < 20) this.earlyErrors.push([error, context]);
      void this.decide();
      return;
    }
    if (!this.collectionEnabled) return;

    try {
      const firebase = this.getFirebaseModules();
      if (!firebase) return;

      // Never ship the raw message (may contain file paths / model names);
      // keep the name + stack frames and replace the message with a code.
      const original = error instanceof Error ? error : new Error(String(error));
      const sanitized = new Error(sanitizeErrorCode(original.message) ?? 'unknown');
      sanitized.name = original.name;
      if (original.stack) {
        const frames = original.stack.split('\n').filter(line => /^\s+at\s|^\S*@\S+:\d+:\d+$/.test(line));
        sanitized.stack = [`${sanitized.name}: ${sanitized.message}`, ...frames].join('\n');
      }
      if (context) {
        firebase.crashlytics.log(context);
      }
      firebase.crashlytics.recordError(sanitized);
    } catch {
      // Crash reporting is best-effort only.
    }
  }

  getRemoteString(key: keyof typeof REMOTE_CONFIG_DEFAULTS): string {
    try {
      const firebase = this.getFirebaseModules();
      if (!firebase) return REMOTE_CONFIG_DEFAULTS[key];

      const value = firebase.remoteConfig.getValue(key).asString();
      return value || REMOTE_CONFIG_DEFAULTS[key];
    } catch {
      return REMOTE_CONFIG_DEFAULTS[key];
    }
  }

  trackAppOpened(): Promise<void> {
    return this.track('app_opened');
  }

  trackAppJsMounted(): Promise<void> {
    return this.track('app_js_mounted');
  }

  trackProvidersReady(durationMs: number, hasConversations: boolean): Promise<void> {
    return this.track('providers_ready', {
      duration_ms: durationMs,
      has_conversations: hasConversations,
    });
  }

  trackFirstRunScreenShown(variant: string, recommendedModelId: string): Promise<void> {
    return this.trackOnce('first_run_screen_shown', 'first_run_screen_shown', {
      variant,
      recommended_model_id: recommendedModelId,
    });
  }

  trackFirstRunCtaTapped(modelId: string, sizeBytes: number): Promise<void> {
    return this.track('first_run_cta_tapped', {
      model_id: modelId,
      size_bytes: sizeBytes,
    });
  }

  trackOnboardingStarted(variant: string, recommendedModelId: string): Promise<void> {
    return this.trackOnce('onboarding_started', 'onboarding_started', {
      variant,
      recommended_model_id: recommendedModelId,
    });
  }

  trackStarterModelSelected(modelId: string, source: string, isPremium: boolean): Promise<void> {
    return this.track('starter_model_selected', {
      model_id: modelId,
      source,
      is_premium: isPremium,
    });
  }

  trackChatCreated(source: string): Promise<void> {
    return this.track('chat_created', { source });
  }

  trackChatReopened(messageCount: number): Promise<void> {
    return this.track('chat_reopened', { message_count: messageCount });
  }

  trackTaskStarted(params: AnalyticsParams): Promise<void> {
    return this.track('task_started', params);
  }

  trackTaskCompleted(params: AnalyticsParams): Promise<void> {
    return this.track('task_completed', params);
  }

  trackFirstPromptSent(params: AnalyticsParams): Promise<void> {
    return this.trackOnce('first_prompt_sent', 'first_prompt_sent', params);
  }

  trackFirstAnswerCompleted(params: AnalyticsParams): Promise<void> {
    return this.trackOnce('first_answer_completed', 'first_answer_completed', params);
  }

  trackModelLoadStarted(params: AnalyticsParams): Promise<void> {
    return this.track('model_load_started', params);
  }

  trackModelLoaded(params: AnalyticsParams): Promise<void> {
    return this.track('model_loaded', params);
  }

  trackModelLoadFailed(params: AnalyticsParams): Promise<void> {
    return this.track('model_load_failed', params);
  }

  trackInferenceFailed(params: AnalyticsParams): Promise<void> {
    return this.track('model_inference_failed', params);
  }

  trackPaywallOpened(featureName?: string | null, source: string = 'unknown'): Promise<void> {
    return this.track('paywall_opened', {
      feature: normalizeFeature(featureName),
      source,
    });
  }

  trackPaywallSuppressed(featureName?: string | null, reason: string = 'pre_activation'): Promise<void> {
    return this.track('paywall_suppressed', {
      feature: normalizeFeature(featureName),
      reason,
    });
  }

  trackPremiumScreenViewed(featureName?: string | null, source: string = 'unknown'): Promise<void> {
    return this.track('premium_screen_viewed', {
      feature: normalizeFeature(featureName),
      source,
    });
  }

  trackPaywallDismissed(featureName?: string | null): Promise<void> {
    return this.track('paywall_dismissed', {
      feature: normalizeFeature(featureName),
    });
  }

  trackPremiumFeatureTapped(featureName: string, source: string = 'locked_feature'): Promise<void> {
    return this.track('premium_feature_tapped', {
      feature: normalizeFeature(featureName),
      source,
    });
  }

  trackPurchaseBuyTapped(featureName?: string | null, price?: string): Promise<void> {
    return this.track('purchase_buy_tapped', {
      feature: normalizeFeature(featureName),
      price,
    });
  }

  trackStoreReady(source: string, productCount: number): Promise<void> {
    return this.track('store_ready', {
      source,
      product_count: productCount,
    });
  }

  trackStoreUnavailable(source: string, error?: string): Promise<void> {
    return this.track('store_unavailable', {
      source,
      error,
    });
  }

  trackPurchaseSheetRequested(sku: string, featureName?: string | null): Promise<void> {
    return this.track('purchase_sheet_requested', {
      sku,
      feature: normalizeFeature(featureName),
    });
  }

  trackPurchaseSheetShown(sku: string, featureName?: string | null): Promise<void> {
    return this.track('purchase_sheet_shown', {
      sku,
      feature: normalizeFeature(featureName),
    });
  }

  trackPurchaseState(params: AnalyticsParams): Promise<void> {
    return this.track('purchase_state', params);
  }

  trackPurchaseCancelled(featureName?: string | null): Promise<void> {
    return this.track('purchase_cancelled', {
      feature: normalizeFeature(featureName),
    });
  }

  trackPurchaseFailed(error?: string, featureName?: string | null, billingResponseCode?: string | number | null): Promise<void> {
    return this.track('purchase_failed', {
      feature: normalizeFeature(featureName),
      error,
      billing_response_code: billingResponseCode,
    });
  }

  trackPurchaseSuccess(
    productId: string,
    featureName?: string | null,
    params: AnalyticsParams = {},
  ): Promise<void> {
    return this.track('purchase_success', {
      product_id: productId,
      feature: normalizeFeature(featureName),
      ...params,
    });
  }

  async trackPurchaseRevenue(params: AnalyticsParams): Promise<void> {
    await this.track('purchase', params);
  }

  trackWorkflowTemplateTapped(workflowId: string, source: string): Promise<void> {
    return this.track('workflow_template_tapped', {
      workflow_id: workflowId,
      source,
    });
  }

  trackRestorePurchaseTapped(): Promise<void> {
    return this.track('restore_purchase_tapped');
  }

  trackRestorePurchaseSuccess(hasPremium: boolean, ownedCount: number): Promise<void> {
    return this.track('restore_purchase_success', {
      has_premium: hasPremium,
      owned_count: ownedCount,
    });
  }

  trackRestorePurchaseFailed(error?: string): Promise<void> {
    return this.track('restore_purchase_failed', {
      error,
    });
  }

  trackReviewPromptShown(source: string): Promise<void> {
    return this.track('review_prompt_shown', { source });
  }

  trackReviewPromptDismissed(source: string): Promise<void> {
    return this.track('review_prompt_dismissed', { source });
  }

  trackReviewPromptRated(source: string): Promise<void> {
    return this.track('review_prompt_rated', { source });
  }

  trackVoiceInputStarted(params: AnalyticsParams): Promise<void> {
    return this.track('voice_input_started', params);
  }

  trackVoiceInputCompleted(params: AnalyticsParams): Promise<void> {
    return this.track('voice_input_completed', params);
  }

  trackVoiceInputFailed(params: AnalyticsParams): Promise<void> {
    return this.track('voice_input_failed', params);
  }

  trackModelDownloadStarted(params: AnalyticsParams): Promise<void> {
    return this.track('model_download_started', params);
  }

  trackModelDownloadCompleted(params: AnalyticsParams): Promise<void> {
    return this.track('model_download_completed', params);
  }

  trackModelDownloadFailed(params: AnalyticsParams): Promise<void> {
    return this.track('model_download_failed', params);
  }

  trackModelDownloadCancelled(params: AnalyticsParams): Promise<void> {
    return this.track('model_download_cancelled', params);
  }

  trackModelDownloadBackgrounded(params: AnalyticsParams): Promise<void> {
    return this.track('model_download_backgrounded', params);
  }
}

export const analyticsService = new AnalyticsService();
