import { requireOptionalNativeModule, type EventSubscription } from 'expo-modules-core';

// Mirrors com.google.android.play.core.assetpacks.model.AssetPackStatus.
export const AssetPackStatus = {
  UNKNOWN: 0,
  PENDING: 1,
  DOWNLOADING: 2,
  TRANSFERRING: 3,
  COMPLETED: 4,
  FAILED: 5,
  CANCELED: 6,
  WAITING_FOR_WIFI: 7,
  NOT_INSTALLED: 8,
  REQUIRES_USER_CONFIRMATION: 9,
} as const;

// Mirrors AssetPackErrorCode (subset the app distinguishes).
export const AssetPackErrorCode = {
  NO_ERROR: 0,
  APP_UNAVAILABLE: -1,
  PACK_UNAVAILABLE: -2,
  NETWORK_ERROR: -6,
  INSUFFICIENT_STORAGE: -10,
  UNRECOGNIZED_INSTALLATION: -15,
} as const;

export interface AssetPackState {
  name: string;
  status: number;
  errorCode: number;
  bytesDownloaded: number;
  totalBytes: number;
  transferProgress: number;
}

interface AssetPacksNativeModule {
  getPackAssetsPath(packName: string): string | null;
  getPackState(packName: string): Promise<AssetPackState>;
  fetch(packName: string): Promise<AssetPackState>;
  showConfirmationDialog(): Promise<boolean>;
  removePack(packName: string): Promise<boolean>;
  addListener(event: 'onStateChange', listener: (state: AssetPackState) => void): EventSubscription;
}

/** Null on iOS/web/tests and in builds without the native module. */
export const AssetPacks = requireOptionalNativeModule<AssetPacksNativeModule>('AssetPacks');
