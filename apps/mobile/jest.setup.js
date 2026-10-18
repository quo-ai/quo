/* eslint-env jest */
// Global mocks for unit tests. Native modules are replaced with in-memory or
// no-op implementations so pure logic can run under Node.

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('expo-localization', () => ({
  getCalendars: () => [{ timeZone: 'UTC', uses24hourClock: true }],
  getLocales: () => [
    {
      regionCode: 'US',
      languageCode: 'en',
      temperatureUnit: 'celsius',
      measurementSystem: 'metric',
    },
  ],
}));

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///test-documents/',
  getInfoAsync: jest.fn(async () => ({ exists: false })),
  makeDirectoryAsync: jest.fn(async () => {}),
  deleteAsync: jest.fn(async () => {}),
  copyAsync: jest.fn(async () => {}),
  createDownloadResumable: jest.fn(),
}));

jest.mock('llama.rn', () => ({
  initLlama: jest.fn(),
  loadLlamaModelInfo: jest.fn(),
}));
