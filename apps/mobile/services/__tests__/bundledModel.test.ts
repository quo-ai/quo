import { getInfoAsync, copyAsync, moveAsync } from 'expo-file-system/legacy';

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///test-documents/',
  bundleDirectory: null,
  getInfoAsync: jest.fn(async () => ({ exists: false })),
  makeDirectoryAsync: jest.fn(async () => {}),
  deleteAsync: jest.fn(async () => {}),
  copyAsync: jest.fn(async () => {}),
  moveAsync: jest.fn(async () => {}),
  readAsStringAsync: jest.fn(async () => 'R0dVRg=='), // "GGUF" magic
  createDownloadResumable: jest.fn(),
}));

jest.mock('../analyticsService', () => ({
  analyticsService: { track: jest.fn(async () => {}) },
}));

// Fake Play Asset Delivery module: tests drive pack state and listener events.
// Built inside the factory because imports are hoisted above test-file code.
jest.mock('@/modules/asset-packs/src', () => {
  const listeners = new Set<any>();
  return {
    ...jest.requireActual('@/modules/asset-packs/src'),
    __listeners: listeners,
    AssetPacks: {
      getPackAssetsPath: jest.fn((): string | null => null),
      getPackState: jest.fn(async (): Promise<any> => ({ name: 'starter_model_pack', status: 0, errorCode: -1, bytesDownloaded: 0, totalBytes: 0, transferProgress: 0 })),
      fetch: jest.fn(async (): Promise<any> => ({ name: 'starter_model_pack', status: 1, errorCode: 0, bytesDownloaded: 0, totalBytes: 100, transferProgress: 0 })),
      showConfirmationDialog: jest.fn(async () => true),
      removePack: jest.fn(async () => true),
      addListener: jest.fn((_event: string, listener: any) => {
        listeners.add(listener);
        return { remove: () => listeners.delete(listener) };
      }),
    },
  };
});
const { AssetPacks: mockAssetPacks, __listeners: mockPackListeners } = jest.requireMock('@/modules/asset-packs/src') as {
  AssetPacks: Record<string, jest.Mock>;
  __listeners: Set<(state: any) => void>;
};

import {
  isBundledStarterAvailable,
  materializeBundledStarter,
  getBundledStarterSource,
  deliverStarterPack,
  isStarterPackOnItsWay,
  removeRedundantStarterPack,
} from '../bundledModel';
import { getDefaultModel } from '@/constants/models';

// jest-expo defaults Platform.OS to 'ios'; force android behavior since the
// bundled-model path is android-only.
jest.mock('react-native/Libraries/Utilities/Platform', () => ({
  __esModule: true,
  default: { OS: 'android', select: (objs: any) => objs.android },
}));

const starterFilename = getDefaultModel().modelFilename;
const assetUri = `asset:///bundled-models/${starterFilename}`;
const destPath = `file:///test-documents/models/${starterFilename}`;
const tempPath = `${destPath}.tmp`;

const mockedGetInfo = getInfoAsync as jest.Mock;
const mockedCopy = copyAsync as jest.Mock;
const mockedMove = moveAsync as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockAssetPacks.getPackAssetsPath.mockReturnValue(null);
  mockAssetPacks.getPackState.mockResolvedValue({ name: 'starter_model_pack', status: 0, errorCode: -1, bytesDownloaded: 0, totalBytes: 0, transferProgress: 0 });
});

describe('isBundledStarterAvailable', () => {
  it('is false when the asset pack does not contain the model', async () => {
    mockedGetInfo.mockResolvedValue({ exists: false });
    expect(await isBundledStarterAvailable()).toBe(false);
  });

  it('is true when the asset exists', async () => {
    mockedGetInfo.mockResolvedValue({ exists: true });
    expect(await isBundledStarterAvailable()).toBe(true);
  });
});

describe('getBundledStarterSource', () => {
  it('loads the fast-follow pack file in place (no copy) when Play delivered it', async () => {
    mockAssetPacks.getPackAssetsPath.mockReturnValueOnce('/data/pack/assets');
    const packFile = `file:///data/pack/assets/bundled-models/${starterFilename}`;
    mockedGetInfo.mockImplementation(async (path: string) =>
      path === packFile ? { exists: true, size: getDefaultModel().sizeBytes } : { exists: false });
    expect(await getBundledStarterSource()).toEqual({ path: packFile, isAsset: false });
  });

  it('falls back to the AssetManager copy (install-time / debug assets)', async () => {
    mockedGetInfo.mockResolvedValue({ exists: true });
    expect(await getBundledStarterSource()).toEqual({ path: `bundled-models/${starterFilename}`, isAsset: true });
  });

  it('returns null when neither exists', async () => {
    mockedGetInfo.mockResolvedValue({ exists: false });
    expect(await getBundledStarterSource()).toBeNull();
  });
});

const packState = (status: number, extra: Record<string, number> = {}) => ({
  name: 'starter_model_pack', status, errorCode: 0, bytesDownloaded: 0, totalBytes: 100, transferProgress: 0, ...extra,
});
const emit = (state: any) => mockPackListeners.forEach(listener => listener(state));
const flush = () => new Promise(resolve => setImmediate(resolve));

describe('deliverStarterPack', () => {
  beforeEach(() => mockPackListeners.clear());

  it('is unavailable on installs Play does not manage (sideloaded/dev)', async () => {
    expect(await deliverStarterPack(jest.fn())).toBe('unavailable');
    expect(mockAssetPacks.fetch).not.toHaveBeenCalled();
  });

  it('follows an in-progress download through to completion with progress', async () => {
    mockAssetPacks.getPackState.mockResolvedValue(packState(2, { bytesDownloaded: 10 }));
    const onProgress = jest.fn();
    const result = deliverStarterPack(onProgress);
    await flush();
    expect(mockAssetPacks.fetch).not.toHaveBeenCalled(); // Play already started it
    emit(packState(2, { bytesDownloaded: 50 }));
    emit(packState(4));
    expect(await result).toBe('completed');
    expect(onProgress).toHaveBeenCalledWith(0.475);
    expect(onProgress).toHaveBeenLastCalledWith(1);
  });

  it('fetches a pack that is not installed yet', async () => {
    mockAssetPacks.getPackState.mockResolvedValue(packState(8));
    const result = deliverStarterPack(jest.fn());
    await flush();
    expect(mockAssetPacks.fetch).toHaveBeenCalledWith('starter_model_pack');
    emit(packState(4));
    expect(await result).toBe('completed');
  });

  it('asks before using mobile data and reports waiting_for_wifi when declined', async () => {
    mockAssetPacks.getPackState.mockResolvedValue(packState(9));
    mockAssetPacks.showConfirmationDialog.mockResolvedValueOnce(false);
    expect(await deliverStarterPack(jest.fn())).toBe('waiting_for_wifi');
    expect(mockAssetPacks.showConfirmationDialog).toHaveBeenCalledTimes(1);
  });

  it('reports a full disk distinctly', async () => {
    mockAssetPacks.getPackState.mockResolvedValue(packState(2));
    const result = deliverStarterPack(jest.fn());
    await flush();
    emit({ ...packState(5), errorCode: -10 });
    expect(await result).toBe('insufficient_storage');
  });

  it('isStarterPackOnItsWay is true only while Play delivers it', async () => {
    mockAssetPacks.getPackState.mockResolvedValueOnce(packState(1));
    expect(await isStarterPackOnItsWay()).toBe(true);
    mockAssetPacks.getPackState.mockResolvedValueOnce(packState(8));
    expect(await isStarterPackOnItsWay()).toBe(false);
  });
});

describe('removeRedundantStarterPack', () => {
  it('drops the pack when an upgraded install already has a copied starter', async () => {
    mockAssetPacks.getPackAssetsPath.mockReturnValueOnce('/data/pack/assets');
    mockedGetInfo.mockResolvedValue({ exists: true, size: getDefaultModel().sizeBytes });
    await removeRedundantStarterPack();
    expect(mockAssetPacks.removePack).toHaveBeenCalledWith('starter_model_pack');
  });

  it('keeps the pack when it is the only copy', async () => {
    mockAssetPacks.getPackAssetsPath.mockReturnValueOnce('/data/pack/assets');
    mockedGetInfo.mockResolvedValue({ exists: false });
    await removeRedundantStarterPack();
    expect(mockAssetPacks.removePack).not.toHaveBeenCalled();
  });
});

describe('materializeBundledStarter', () => {
  it('returns true immediately when the model is already materialized', async () => {
    mockedGetInfo.mockImplementation(async (uri: string) =>
      uri === destPath ? { exists: true, size: getDefaultModel().sizeBytes } : { exists: false },
    );
    expect(await materializeBundledStarter()).toBe(true);
    expect(mockedCopy).not.toHaveBeenCalled();
  });

  it('returns false without copying when no asset is bundled', async () => {
    mockedGetInfo.mockResolvedValue({ exists: false });
    expect(await materializeBundledStarter()).toBe(false);
    expect(mockedCopy).not.toHaveBeenCalled();
  });

  it('copies to a temp file, verifies it, then moves it into place', async () => {
    let copied = false;
    mockedGetInfo.mockImplementation(async (uri: string) => {
      if (uri === assetUri) return { exists: true, size: 530_000_000 };
      if (uri.endsWith('models/')) return { exists: true };
      if (uri === tempPath) return copied ? { exists: true, size: 530_000_000 } : { exists: false };
      return { exists: false };
    });
    mockedCopy.mockImplementation(async () => {
      copied = true;
    });

    expect(await materializeBundledStarter()).toBe(true);
    expect(mockedCopy).toHaveBeenCalledWith({ from: assetUri, to: tempPath });
    expect(mockedMove).toHaveBeenCalledWith({ from: tempPath, to: destPath });
  });

  it('never moves a truncated copy into the final path', async () => {
    let copied = false;
    mockedGetInfo.mockImplementation(async (uri: string) => {
      if (uri === assetUri) return { exists: true, size: 530_000_000 };
      if (uri.endsWith('models/')) return { exists: true };
      if (uri === tempPath) return copied ? { exists: true, size: 1_000 } : { exists: false };
      return { exists: false };
    });
    mockedCopy.mockImplementation(async () => {
      copied = true;
    });

    expect(await materializeBundledStarter()).toBe(false);
    expect(mockedMove).not.toHaveBeenCalled();
  });

  it('re-copies when a partial file sits at the final path', async () => {
    let copied = false;
    mockedGetInfo.mockImplementation(async (uri: string) => {
      if (uri === assetUri) return { exists: true, size: 530_000_000 };
      if (uri.endsWith('models/')) return { exists: true };
      if (uri === destPath) return { exists: true, size: 200_000_000 };
      if (uri === tempPath) return copied ? { exists: true, size: 530_000_000 } : { exists: false };
      return { exists: false };
    });
    mockedCopy.mockImplementation(async () => {
      copied = true;
    });

    expect(await materializeBundledStarter()).toBe(true);
    expect(mockedCopy).toHaveBeenCalled();
  });
});
