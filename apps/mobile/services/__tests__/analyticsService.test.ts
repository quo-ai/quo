/**
 * Verifies the analyticsService → @react-native-firebase modular API wiring:
 * instances are fetched once and every call passes the right instance and
 * arguments through the modular functions.
 */
const mockAnalyticsInstance = { __kind: 'analytics' };
const mockCrashlyticsInstance = { __kind: 'crashlytics' };
const mockRemoteConfigInstance = { __kind: 'remoteConfig' };

const mockAnalyticsApi = {
  getAnalytics: jest.fn(() => mockAnalyticsInstance),
  logEvent: jest.fn(async () => {}),
  setAnalyticsCollectionEnabled: jest.fn(async () => {}),
  setUserProperty: jest.fn(async () => {}),
};
const mockCrashlyticsApi = {
  getCrashlytics: jest.fn(() => mockCrashlyticsInstance),
  log: jest.fn(),
  recordError: jest.fn(),
  setCrashlyticsCollectionEnabled: jest.fn(async () => {}),
};
const mockRemoteConfigApi = {
  getRemoteConfig: jest.fn(() => mockRemoteConfigInstance),
  setConfigSettings: jest.fn(async () => {}),
  setDefaults: jest.fn(async () => null),
  fetchAndActivate: jest.fn(async () => true),
  getValue: jest.fn(() => ({ asString: () => 'remote-value' })),
};

jest.mock('@react-native-firebase/analytics', () => mockAnalyticsApi);
jest.mock('@react-native-firebase/crashlytics', () => mockCrashlyticsApi);
jest.mock('@react-native-firebase/remote-config', () => mockRemoteConfigApi);
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { version: '1.4.0' } },
}));

import { analyticsService, sanitizeErrorCode, sanitizeModelId } from '../analyticsService';

describe('analyticsService modular Firebase wiring', () => {
  it('initializes collection and remote config through the modular API', async () => {
    await analyticsService.initialize();

    expect(mockAnalyticsApi.setAnalyticsCollectionEnabled).toHaveBeenCalledWith(mockAnalyticsInstance, true);
    expect(mockCrashlyticsApi.setCrashlyticsCollectionEnabled).toHaveBeenCalledWith(mockCrashlyticsInstance, true);
    expect(mockRemoteConfigApi.setDefaults).toHaveBeenCalledWith(
      mockRemoteConfigInstance,
      expect.objectContaining({ paywall_variant: 'default' }),
    );
    expect(mockRemoteConfigApi.fetchAndActivate).toHaveBeenCalledWith(mockRemoteConfigInstance);
  });

  it('logs events with the bound analytics instance and sanitized params', async () => {
    await analyticsService.track('Test Event!', { foo: 'bar', flag: true });

    expect(mockAnalyticsApi.logEvent).toHaveBeenCalledWith(
      mockAnalyticsInstance,
      'test_event',
      expect.objectContaining({ foo: 'bar', flag: 1, platform: expect.any(String) }),
    );
  });

  it('sets user properties with the bound analytics instance', async () => {
    await analyticsService.setUserProperty('Premium User', true);

    expect(mockAnalyticsApi.setUserProperty).toHaveBeenCalledWith(
      mockAnalyticsInstance,
      'premium_user',
      'true',
    );
  });

  it('records errors through the bound crashlytics instance', () => {
    const error = new Error('boom');
    analyticsService.recordError(error, 'saving conversation');

    expect(mockCrashlyticsApi.log).toHaveBeenCalledWith(mockCrashlyticsInstance, 'saving conversation');
    expect(mockCrashlyticsApi.recordError).toHaveBeenCalledWith(
      mockCrashlyticsInstance,
      expect.objectContaining({ message: 'boom' }),
      undefined,
    );
  });

  it('strips user-derived text from recorded error messages', () => {
    mockCrashlyticsApi.recordError.mockClear();
    analyticsService.recordError(new Error('Failed to load model at /data/user/0/app/files/models/My Diary.gguf'));

    const recorded = (mockCrashlyticsApi.recordError.mock.calls[0] as unknown[])[1] as Error;
    expect(recorded.message).toBe('invalid_model');
    expect(recorded.stack).not.toContain('Diary');
  });

  it('maps custom model ids and raw error strings before logging', async () => {
    mockAnalyticsApi.logEvent.mockClear();
    await analyticsService.track('model_load_failed', {
      model_id: 'custom-my secret model-1700000000',
      error: 'ENOENT: no such file "/sdcard/Download/secret.gguf"',
    });

    const params = (mockAnalyticsApi.logEvent.mock.calls[0] as unknown[])[2] as Record<string, unknown>;
    expect(params.model_id).toBe('custom');
    expect(params.error).toBe('file_not_found');
  });

  it('sanitizes error strings into codes', () => {
    expect(sanitizeErrorCode('load_returned_false')).toBe('load_returned_false');
    expect(sanitizeErrorCode('Request to https://huggingface.co/x/y failed: network error')).toBe('network');
    expect(sanitizeErrorCode("Could not open 'cancel plan.txt'")).toBe('other');
    expect(sanitizeErrorCode(undefined)).toBeUndefined();
    expect(sanitizeModelId('qwen35-0.8b')).toBe('qwen35-0.8b');
  });

  it('stops sending when the user opts out, and resumes when re-enabled', async () => {
    await analyticsService.setAnalyticsEnabled(false);
    expect(mockAnalyticsApi.setAnalyticsCollectionEnabled).toHaveBeenLastCalledWith(mockAnalyticsInstance, false);
    expect(mockCrashlyticsApi.setCrashlyticsCollectionEnabled).toHaveBeenLastCalledWith(mockCrashlyticsInstance, false);
    expect(await analyticsService.isAnalyticsEnabled()).toBe(false);

    mockAnalyticsApi.logEvent.mockClear();
    mockCrashlyticsApi.recordError.mockClear();
    await analyticsService.track('ignored_event');
    analyticsService.recordError(new Error('ignored'));
    expect(mockAnalyticsApi.logEvent).not.toHaveBeenCalled();
    expect(mockCrashlyticsApi.recordError).not.toHaveBeenCalled();

    await analyticsService.setAnalyticsEnabled(true);
    await analyticsService.track('sent_event');
    expect(mockAnalyticsApi.logEvent).toHaveBeenCalledTimes(1);
  });

  it('reads remote config values through the bound instance', () => {
    expect(analyticsService.getRemoteString('paywall_variant')).toBe('remote-value');
    expect(mockRemoteConfigApi.getValue).toHaveBeenCalledWith(mockRemoteConfigInstance, 'paywall_variant');
  });

  it('fetches each Firebase instance exactly once across calls', async () => {
    await analyticsService.track('another_event');
    analyticsService.recordError(new Error('x'));

    expect(mockAnalyticsApi.getAnalytics).toHaveBeenCalledTimes(1);
    expect(mockCrashlyticsApi.getCrashlytics).toHaveBeenCalledTimes(1);
    expect(mockRemoteConfigApi.getRemoteConfig).toHaveBeenCalledTimes(1);
  });
});
