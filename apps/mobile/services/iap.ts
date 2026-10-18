import * as RNIap from 'react-native-iap';
import { ErrorCode, Purchase, PurchaseAndroid, PurchaseError, Product } from 'react-native-iap';
import { analyticsService } from './analyticsService';

export const IAP_SKUS = {
  PREMIUM_LIFETIME: 'quopremium',
} as const;

export type IapSku = typeof IAP_SKUS[keyof typeof IAP_SKUS];

let purchaseUpdateSubscription: { remove: () => void } | null = null;
let purchaseErrorSubscription: { remove: () => void } | null = null;

export interface IapPurchaseRecord {
  productId: string;
  transactionId?: string | null;
  purchaseToken?: string | null;
  purchaseState?: string | null;
  displayPrice?: string;
  currency?: string;
  value?: number | null;
}

let onPurchaseSuccess: ((purchase: IapPurchaseRecord) => Promise<void> | void) | null = null;
let onPurchasePending: ((purchase: IapPurchaseRecord) => void) | null = null;
let onPurchaseError: ((error: string, code?: string | number | null) => void) | null = null;

let availableProducts: Product[] = [];
// isConnected: billing connection + purchase listeners are live.
// isInitialized: connected AND the premium product was fetched (purchasable).
let isConnected = false;
let isInitialized = false;
let initPromise: Promise<IapInitResult> | null = null;

export interface IapInitResult {
  ok: boolean;
  error?: string;
  products?: Product[];
}

export async function iapInit(): Promise<IapInitResult> {
  if (isInitialized) {
    return { ok: true, products: availableProducts };
  }

  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    try {
      if (!isConnected) {
        const connected = await RNIap.initConnection();
        if (!connected) throw new Error('billing_connection_failed');
        // Attach listeners before fetching products: an offline fetch failure
        // must not leave a live connection without a purchase listener
        // (pending purchases completing later would never be acknowledged).
        setupPurchaseListeners();
        isConnected = true;
      }

      const products = await RNIap.fetchProducts({
        skus: [IAP_SKUS.PREMIUM_LIFETIME],
        type: 'in-app',
      });

      availableProducts = products && Array.isArray(products) ? products as Product[] : [];
      isInitialized = true;

      return { ok: true, products: availableProducts };
    } catch (e: any) {
      availableProducts = [];
      isInitialized = false;
      return { ok: false, error: e?.message ?? String(e) };
    } finally {
      initPromise = null;
    }
  })();

  return initPromise;
}

export function iapIsInitialized(): boolean {
  return isInitialized;
}

/** Billing connection + purchase listeners are live (products may not be). */
export function iapIsConnected(): boolean {
  return isConnected;
}

/**
 * Country of the user's store account (Play: ISO alpha-2, App Store:
 * alpha-3), or null if unknown. Never throws and never waits longer than
 * `timeoutMs`: offline, no Play services, or a stalled connection all just
 * yield null. Android connects natively on demand (single-flight with
 * iapInit's connection).
 */
export async function getStoreCountry(timeoutMs = 4000): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<null>(resolve => {
      timer = setTimeout(() => resolve(null), timeoutMs);
    });
    const code = await Promise.race([RNIap.getStorefront(), timeout]);
    return typeof code === 'string' && code.trim() ? code.trim().toUpperCase() : null;
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function getProductPricing(productId?: string | null) {
  const product = productId ? availableProducts.find((p) => p.id === productId) : undefined;
  return {
    displayPrice: product?.displayPrice,
    currency: product?.currency,
    value: typeof product?.price === 'number' ? product.price : null,
  };
}

function toPurchaseRecord(purchase: Purchase): IapPurchaseRecord {
  const productId = purchase.productId || '';
  return {
    productId,
    transactionId: purchase.transactionId || (purchase as any).id || null,
    purchaseToken: purchase.purchaseToken || null,
    purchaseState: purchase.purchaseState || null,
    ...getProductPricing(productId),
  };
}

function setupPurchaseListeners() {
  removePurchaseListeners();

  purchaseUpdateSubscription = RNIap.purchaseUpdatedListener(async (purchase) => {
    const purchaseRecord = toPurchaseRecord(purchase);
    const receipt = purchase.purchaseToken || purchase.transactionId;

    void analyticsService.trackPurchaseState({
      sku: purchaseRecord.productId,
      transaction_id: purchaseRecord.transactionId,
      purchase_state: purchaseRecord.purchaseState,
      value: purchaseRecord.value,
      currency: purchaseRecord.currency,
    });

    if (purchaseRecord.purchaseState === 'pending') {
      onPurchasePending?.(purchaseRecord);
      return;
    }

    // Only a completed purchase grants/acknowledges. 'unknown' (or a missing
    // state) must not unlock premium; the next restore/reconcile will pick it
    // up once the store reports it as purchased.
    if (purchaseRecord.purchaseState !== 'purchased') {
      return;
    }

    if (receipt) {
      try {
        if (onPurchaseSuccess && purchaseRecord.productId) {
          await onPurchaseSuccess(purchaseRecord);
        }
        
        await RNIap.finishTransaction({ purchase, isConsumable: false });
      } catch (ackErr) {
        console.warn('finishTransaction failed', ackErr);
        void analyticsService.trackPurchaseFailed(
          ackErr instanceof Error ? ackErr.message : String(ackErr),
          null,
          'finish_transaction_failed',
        );
      }
    }
  });

  purchaseErrorSubscription = RNIap.purchaseErrorListener((error: PurchaseError) => {
    if (error.code === ErrorCode.UserCancelled) {
      if (onPurchaseError) {
        onPurchaseError('cancelled', error.code);
      }
      return;
    }
    if (onPurchaseError) {
      onPurchaseError(error.message || 'Purchase failed', error.code);
    }
  });
}

function removePurchaseListeners() {
  if (purchaseUpdateSubscription) {
    purchaseUpdateSubscription.remove();
    purchaseUpdateSubscription = null;
  }
  if (purchaseErrorSubscription) {
    purchaseErrorSubscription.remove();
    purchaseErrorSubscription = null;
  }
}

export async function iapEnd(): Promise<void> {
  try {
    removePurchaseListeners();
    await RNIap.endConnection();
  } catch {
    // ignore
  } finally {
    isConnected = false;
    isInitialized = false;
    initPromise = null;
  }
}

export function setIapCallbacks(
  successCallback: ((purchase: IapPurchaseRecord) => Promise<void> | void) | null,
  errorCallback: ((error: string, code?: string | number | null) => void) | null,
  pendingCallback?: ((purchase: IapPurchaseRecord) => void) | null,
) {
  onPurchaseSuccess = successCallback;
  onPurchaseError = errorCallback;
  onPurchasePending = pendingCallback ?? null;
}

export interface IapPurchaseResult {
  ok: boolean;
  error?: string;
  code?: string | number | null;
}

export async function iapPurchase(sku: IapSku, featureName?: string | null): Promise<IapPurchaseResult> {
  // Guard: ensure IAP is initialized and the product was fetched
  if (!isInitialized) {
    return { ok: false, error: 'Store not initialized. Please try again.' };
  }

  const productExists = availableProducts.some((p) => p.id === sku);
  if (!productExists) {
    return { ok: false, error: 'Product not available. Please check your connection and try again.' };
  }

  try {
    void analyticsService.trackPurchaseSheetRequested(sku, featureName);
    await RNIap.requestPurchase({
      request: {
        google: {
          skus: [sku],
        },
        apple: {
          sku,
        },
      },
      type: 'in-app',
    });
    void analyticsService.trackPurchaseSheetShown(sku, featureName);

    return { ok: true };
  } catch (e: any) {
    const errorMsg = e?.message ?? String(e);
    
    if (e?.code === ErrorCode.UserCancelled || errorMsg.toLowerCase().includes('cancel')) {
      return { ok: false, error: 'cancelled', code: e?.code };
    }
    
    return { ok: false, error: errorMsg, code: e?.code };
  }
}

export interface IapEntitlement {
  hasPremium: boolean;
  /** Premium was bought but the store still reports it as pending payment. */
  hasPendingPremium: boolean;
  ownedSkus: string[];
}

/**
 * iOS StoreKit can return revoked (refunded/family-sharing-revoked) or expired
 * transactions from getAvailablePurchases() depending on StoreKit version.
 * react-native-iap v14 exposes these on PurchaseIOS as `revocationDateIOS`
 * (+ `revocationReasonIOS`) and `expirationDateIOS`. A revoked or expired
 * transaction must not grant the entitlement. Android purchases never carry
 * these fields, so they pass through unchanged.
 */
function isPurchaseEntitled(purchase: Purchase): boolean {
  const p = purchase as Purchase & {
    revocationDateIOS?: number | null;
    revocationReasonIOS?: string | null;
    expirationDateIOS?: number | null;
  };
  if (p.revocationDateIOS != null || p.revocationReasonIOS != null) {
    return false;
  }
  // quopremium is a lifetime non-consumable so expiration should never be set,
  // but respect it defensively if StoreKit reports one in the past.
  if (typeof p.expirationDateIOS === 'number' && p.expirationDateIOS > 0 && p.expirationDateIOS < Date.now()) {
    return false;
  }
  return true;
}

/**
 * Reads the store's owned purchases, grants only completed ('purchased')
 * ones, and finishes/acknowledges them. On Android an unacknowledged purchase
 * is auto-refunded by Google after 3 days, so this doubles as the
 * acknowledgement reconcile. Throws on store errors so callers can tell a
 * failure apart from "nothing owned".
 *
 * iOS: getAvailablePurchases() can show an Apple ID sign-in sheet — only call
 * it from user-initiated flows (or once per session on resume).
 */
export async function iapRestoreEntitlement(): Promise<IapEntitlement> {
  const allPurchases = await RNIap.getAvailablePurchases();
  const purchases = allPurchases.filter(isPurchaseEntitled);
  const completed = purchases.filter((p) => p.purchaseState === 'purchased');

  for (const purchase of completed) {
    const receipt = purchase.purchaseToken || purchase.transactionId;
    if (purchase.productId !== IAP_SKUS.PREMIUM_LIFETIME || !receipt) continue;
    // Already acknowledged on Android: nothing to finish.
    if ((purchase as PurchaseAndroid).isAcknowledgedAndroid === true) continue;

    try {
      await RNIap.finishTransaction({ purchase, isConsumable: false });
    } catch (err) {
      console.warn('Failed to finish restored transaction', err);
      void analyticsService.trackPurchaseFailed(
        err instanceof Error ? err.message : String(err),
        null,
        'finish_transaction_failed',
      );
    }
  }

  const ownedSkus = completed
    .map((p) => p.productId)
    .filter(Boolean) as string[];

  const hasPremium = ownedSkus.includes(IAP_SKUS.PREMIUM_LIFETIME);
  const hasPendingPremium = !hasPremium && purchases.some(
    (p) => p.productId === IAP_SKUS.PREMIUM_LIFETIME && p.purchaseState === 'pending',
  );
  return { hasPremium, hasPendingPremium, ownedSkus };
}
