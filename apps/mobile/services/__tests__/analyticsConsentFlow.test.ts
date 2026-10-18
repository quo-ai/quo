/**
 * Consent gating in analyticsService: nothing is collected or fetched until
 * the decision is known; opt-in regions wait for an explicit choice; a slow
 * or failing region check can never block or leave the decision pending.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ConsentRegionCheck } from '@/utils/analyticsConsent';

const mockAnalyticsApi = {
  getAnalytics: jest.fn(() => ({})),
  logEvent: jest.fn(async () => {}),
  setAnalyticsCollectionEnabled: jest.fn(async (_instance: unknown, _enabled: boolean) => {}),
  setUserProperty: jest.fn(async () => {}),
};
const mockCrashlyticsApi = {
  getCrashlytics: jest.fn(() => ({})),
  log: jest.fn(),
  recordError: jest.fn(),
  setCrashlyticsCollectionEnabled: jest.fn(async (_instance: unknown, _enabled: boolean) => {}),
};
const mockRemoteConfigApi = {
  getRemoteConfig: jest.fn(() => ({})),
  setConfigSettings: jest.fn(async () => {}),
  setDefaults: jest.fn(async () => null),
  fetchAndActivate: jest.fn(async () => true),
  getValue: jest.fn(() => ({ asString: () => '' })),
};

jest.mock('@react-native-firebase/analytics', () => mockAnalyticsApi);
jest.mock('@react-native-firebase/crashlytics', () => mockCrashlyticsApi);
jest.mock('@react-native-firebase/remote-config', () => mockRemoteConfigApi);
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { version: '1.5.0' } } }));

type Service = typeof import('../analyticsService').analyticsService;

/** A fresh service instance per test (the module exports a singleton). */
function freshService(resolver?: () => Promise<ConsentRegionCheck>): Service {
  let service!: Service;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    service = require('../analyticsService').analyticsService;
  });
  if (resolver) service.setRegionResolver(resolver);
  return service;
}

const lastCollectionCall = () => mockAnalyticsApi.setAnalyticsCollectionEnabled.mock.calls.at(-1)?.[1];

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
});

describe('outside consent regions', () => {
  it('collects, fetches remote config and never prompts', async () => {
    const service = freshService(async () => ({ requiresConsent: false, definitive: true }));
    await service.initialize();

    expect(lastCollectionCall()).toBe(true);
    expect(mockRemoteConfigApi.fetchAndActivate).toHaveBeenCalled();
    expect(await service.isConsentPromptNeeded()).toBe(false);
    expect(await AsyncStorage.getItem('@quo_analytics_region')).toBe('notice');
  });
});

describe('consent regions (EU/EEA)', () => {
  const eu = async (): Promise<ConsentRegionCheck> => ({ requiresConsent: true, definitive: true });

  it('collects and fetches nothing before the user answers', async () => {
    const service = freshService(eu);
    await service.initialize();
    await service.track('app_opened');
    service.recordError(new Error('boom'));

    expect(lastCollectionCall()).toBe(false);
    expect(mockCrashlyticsApi.setCrashlyticsCollectionEnabled.mock.calls.at(-1)?.[1]).toBe(false);
    expect(mockAnalyticsApi.logEvent).not.toHaveBeenCalled();
    expect(mockCrashlyticsApi.recordError).not.toHaveBeenCalled();
    expect(mockRemoteConfigApi.fetchAndActivate).not.toHaveBeenCalled();
    expect(await service.isConsentPromptNeeded()).toBe(true);
  });

  it('starts collecting after "Allow" and remembers it', async () => {
    const service = freshService(eu);
    await service.initialize();
    const promptListener = jest.fn();
    service.subscribeConsentPrompt(promptListener);

    await service.setAnalyticsEnabled(true);
    await service.track('after_consent');

    expect(lastCollectionCall()).toBe(true);
    expect(mockAnalyticsApi.logEvent).toHaveBeenCalledTimes(1);
    expect(mockRemoteConfigApi.fetchAndActivate).toHaveBeenCalledTimes(1);
    expect(promptListener).toHaveBeenCalledWith(false);
    expect(await AsyncStorage.getItem('@quo_analytics_enabled')).toBe('true');

    // Next launch: the stored choice decides; no region check, no prompt.
    const resolver = jest.fn(eu);
    const next = freshService(resolver);
    expect(await next.isAnalyticsEnabled()).toBe(true);
    expect(await next.isConsentPromptNeeded()).toBe(false);
    expect(resolver).not.toHaveBeenCalled();
  });

  it('stays off after "Don\'t allow" and does not ask again', async () => {
    const service = freshService(eu);
    await service.initialize();
    await service.setAnalyticsEnabled(false);

    const next = freshService(eu);
    expect(await next.isAnalyticsEnabled()).toBe(false);
    expect(await next.isConsentPromptNeeded()).toBe(false);
  });

  it('holds early errors and drops them when consent is not given', async () => {
    const service = freshService(eu);
    service.recordError(new Error('during startup'));
    await service.initialize();
    expect(mockCrashlyticsApi.recordError).not.toHaveBeenCalled();
  });
});

describe('region check never blocks', () => {
  it('falls back to the device region if the check hangs, and re-checks next launch', async () => {
    jest.useFakeTimers();
    try {
      const service = freshService(() => new Promise<ConsentRegionCheck>(() => {}));
      const enabled = service.isAnalyticsEnabled();
      await jest.advanceTimersByTimeAsync(6000);
      // jest.setup mocks the device region as US.
      expect(await enabled).toBe(true);
      expect(await AsyncStorage.getItem('@quo_analytics_region')).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('falls back to the device region if the check throws', async () => {
    const service = freshService(async () => { throw new Error('store unavailable'); });
    expect(await service.isAnalyticsEnabled()).toBe(true);
    expect(await service.isConsentPromptNeeded()).toBe(false);
  });

  it('uses a cached region without re-checking', async () => {
    await AsyncStorage.setItem('@quo_analytics_region', 'consent');
    const resolver = jest.fn(async () => ({ requiresConsent: false, definitive: true }));
    const service = freshService(resolver);
    expect(await service.isConsentPromptNeeded()).toBe(true);
    expect(resolver).not.toHaveBeenCalled();
  });
});
