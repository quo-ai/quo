import React, { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert, AppState, Platform } from 'react-native';
import {
  iapEnd,
  iapInit,
  iapIsConnected,
  iapIsInitialized,
  iapPurchase,
  iapRestoreEntitlement,
  IAP_SKUS,
  type IapPurchaseRecord,
  setIapCallbacks,
} from '@/services/iap';
import { analyticsService } from '@/services/analyticsService';
import { PREMIUM_PRICE_FALLBACK } from '@/constants/premium';

// Re-export for the many UI consumers that import these from the context.
export { PREMIUM_FEATURES, FREE_TIER_LIMITS, type PremiumFeature } from '@/constants/premium';

const PREMIUM_STORAGE_KEY = 'quo_premium_status';
const ACTIVATION_STORAGE_KEY = 'quo_activation_status';
export type PremiumStoreStatus = 'unknown' | 'checking' | 'ready' | 'unavailable';
type PurchaseOutcome = 'cancelled' | 'failed' | 'success';

export interface OpenUpgradeModalOptions {
  /**
   * 'user' (default): a deliberate tap (locked feature, banner, onboarding,
   * Settings) — always opens the paywall.
   * 'automatic': app-initiated nag (e.g. a limit hit mid-generation) —
   * suppressed with "Try Quo First" until the user has seen a first answer.
   */
  trigger?: 'user' | 'automatic';
}

// Android: deferred so billing setup never competes with app start.
const ANDROID_RECONCILE_DELAY_MS = 3000;

async function savePremiumStatus(status: boolean) {
  try {
    await AsyncStorage.setItem(PREMIUM_STORAGE_KEY, JSON.stringify(status));
  } catch {
    // Ignore save errors
  }
}

interface PremiumContextType {
  isPremium: boolean;
  hasActivated: boolean;
  showUpgradeModal: boolean;
  upgradeFeatureTrigger: string | null;
  isLoading: boolean;
  isProcessingPurchase: boolean;
  productPrice: string;
  storeStatus: PremiumStoreStatus;
  storeError: string | null;
  openUpgradeModal: (featureName?: string, options?: OpenUpgradeModalOptions) => void;
  closeUpgradeModal: () => void;
  handleUpgrade: () => void;
  restorePurchases: () => void;
  /** (Re)connects to the store and fetches the product; used by paywall Retry. */
  ensureStoreReady: (silent?: boolean, source?: string) => Promise<boolean>;
  checkPremiumFeature: (featureName: string) => boolean;
  markActivated: () => void;
}

const PremiumContext = createContext<PremiumContextType | undefined>(undefined);

interface PremiumProviderProps {
  children: ReactNode;
}

function parseDisplayPrice(price: string): number | null {
  const normalized = price.replace(/[^0-9.,]+/g, '').replace(',', '.');
  const value = Number.parseFloat(normalized);
  return Number.isFinite(value) ? value : null;
}

export function PremiumProvider({ children }: PremiumProviderProps) {
  const [isPremium, setIsPremium] = useState(false);
  const [hasActivated, setHasActivated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessingPurchase, setIsProcessingPurchase] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [upgradeFeatureTrigger, setUpgradeFeatureTrigger] = useState<string | null>(null);
  const [productPrice, setProductPrice] = useState(PREMIUM_PRICE_FALLBACK);
  const [storeStatus, setStoreStatus] = useState<PremiumStoreStatus>('unknown');
  const [storeError, setStoreError] = useState<string | null>(null);
  const upgradeFeatureTriggerRef = useRef<string | null>(null);
  const purchaseFeatureRef = useRef<string | null>(null);
  const purchaseOutcomeRef = useRef<{ key: string; at: number } | null>(null);
  // iOS: getAvailablePurchases() can trigger an Apple ID sign-in sheet; doing it
  // on every foreground would nag users repeatedly. Limit to once per session.
  const resumeRestoreDoneRef = useRef(false);
  const productPriceRef = useRef(productPrice);

  useEffect(() => {
    productPriceRef.current = productPrice;
  }, [productPrice]);

  useEffect(() => {
    upgradeFeatureTriggerRef.current = upgradeFeatureTrigger;
  }, [upgradeFeatureTrigger]);

  useEffect(() => {
    if (!isLoading) {
      void analyticsService.setUserProperty('premium_status', isPremium ? 'premium' : 'free');
    }
  }, [isLoading, isPremium]);

  const syncProductPrice = useCallback((products?: Array<{ id: string; displayPrice?: string }>) => {
    if (!products || products.length === 0) return;

    const premiumProduct = products.find(p => p.id === IAP_SKUS.PREMIUM_LIFETIME);
    if (premiumProduct?.displayPrice) {
      setProductPrice(premiumProduct.displayPrice);
    }
  }, []);

  const applyRestoredEntitlement = useCallback(async (source: string, showAlert: boolean) => {
    const entitlement = await iapRestoreEntitlement();
    void analyticsService.trackRestorePurchaseSuccess(entitlement.hasPremium, entitlement.ownedSkus.length);

    if (entitlement.hasPremium) {
      setIsPremium(true);
      await savePremiumStatus(true);
      if (showAlert) {
        Alert.alert('Restored', 'Premium has been restored on this device.');
      }
    } else if (showAlert && entitlement.hasPendingPremium) {
      Alert.alert(
        'Purchase Pending',
        `${Platform.OS === 'ios' ? 'The App Store' : 'Google Play'} is still processing your purchase. Premium will unlock automatically after it completes.`
      );
    } else if (showAlert) {
      Alert.alert('No Purchases Found', 'No premium purchases were found for your account.');
    }

    void analyticsService.trackPurchaseState({
      sku: IAP_SKUS.PREMIUM_LIFETIME,
      purchase_state: entitlement.hasPremium ? 'restored' : entitlement.hasPendingPremium ? 'pending' : 'not_owned',
      source,
      owned_count: entitlement.ownedSkus.length,
    });

    return entitlement;
  }, []);

  const ensureStoreReady = useCallback(async (silent: boolean = false, source: string = 'unknown'): Promise<boolean> => {
    setStoreStatus('checking');
    setStoreError(null);
    const initResult = await iapInit();
    const productCount = initResult.products?.length ?? 0;
    if (initResult.ok && productCount > 0) {
      syncProductPrice(initResult.products);
      setStoreStatus('ready');
      void analyticsService.trackStoreReady(source, productCount);
      return true;
    }

    const error = initResult.error || 'premium_product_unavailable';
    setStoreStatus('unavailable');
    setStoreError(error);
    void analyticsService.trackStoreUnavailable(source, error);
    if (!silent) {
      Alert.alert(
        'Store Unavailable',
        'Connect to the internet once to complete your purchase. Your AI will continue working offline afterward.'
      );
    }

    return false;
  }, [syncProductPrice]);

  const trackPurchaseOutcome = useCallback((
    outcome: PurchaseOutcome,
    track: (featureName: string | null) => void,
  ) => {
    const featureName = purchaseFeatureRef.current ?? upgradeFeatureTriggerRef.current;
    const key = `${outcome}:${featureName || 'general'}`;
    const now = Date.now();

    if (purchaseOutcomeRef.current?.key === key && now - purchaseOutcomeRef.current.at < 3000) {
      return;
    }

    purchaseOutcomeRef.current = { key, at: now };
    track(featureName);
    purchaseFeatureRef.current = null;
  }, []);

  const getPurchaseFeature = useCallback(() => {
    return purchaseFeatureRef.current ?? upgradeFeatureTriggerRef.current;
  }, []);

  const handlePurchasePending = useCallback((purchase: IapPurchaseRecord) => {
    setIsProcessingPurchase(false);
    const featureName = getPurchaseFeature();
    void analyticsService.trackPurchaseState({
      sku: purchase.productId,
      transaction_id: purchase.transactionId,
      purchase_state: purchase.purchaseState || 'pending',
      feature: featureName,
      value: purchase.value,
      currency: purchase.currency,
    });
    Alert.alert(
      'Purchase Pending',
      `${Platform.OS === 'ios' ? 'The App Store' : 'Google Play'} is still processing this purchase. Premium will unlock automatically after it completes.`
    );
  }, [getPurchaseFeature]);

  // Handle successful purchase from listener
  const handlePurchaseSuccess = useCallback(async (purchase: IapPurchaseRecord) => {
    if (purchase.productId === IAP_SKUS.PREMIUM_LIFETIME) {
      const featureName = getPurchaseFeature();
      const value = purchase.value ?? parseDisplayPrice(productPriceRef.current);
      const currency = purchase.currency || 'USD';
      const transactionId = purchase.transactionId || `local_${Date.now()}`;
      const paywallVariant = analyticsService.getRemoteString('paywall_variant');
      const paywallTrigger = featureName ? 'locked_feature' : 'manual';
      const purchaseParams = {
        transaction_id: transactionId,
        product_id: purchase.productId,
        item_id: purchase.productId,
        value,
        currency,
        paywall_variant: paywallVariant,
        paywall_trigger: paywallTrigger,
        purchase_state: purchase.purchaseState || 'purchased',
        items: [
          {
            item_id: purchase.productId,
            item_name: 'Quo Premium Lifetime',
            item_category: 'in_app_purchase',
            price: value,
            quantity: 1,
          },
        ],
      };

      trackPurchaseOutcome('success', (featureName) => {
        void analyticsService.trackPurchaseSuccess(purchase.productId, featureName, purchaseParams);
        void analyticsService.trackPurchaseRevenue(purchaseParams);
      });
      setIsPremium(true);
      await savePremiumStatus(true);
      setShowUpgradeModal(false);
      setUpgradeFeatureTrigger(null);
      setIsProcessingPurchase(false);
      Alert.alert('Unlocked', 'Premium is now enabled.');
    }
  }, [getPurchaseFeature, trackPurchaseOutcome]);

  // Handle purchase error from listener
  const handlePurchaseError = useCallback((error: string, code?: string | number | null) => {
    setIsProcessingPurchase(false);
    if (error && error.toLowerCase().includes('cancel')) {
      trackPurchaseOutcome('cancelled', (featureName) => {
        void analyticsService.trackPurchaseCancelled(featureName);
      });
    } else {
      trackPurchaseOutcome('failed', (featureName) => {
        void analyticsService.trackPurchaseFailed(error, featureName, code);
      });
    }
    // Only show alert if not already handled
    if (error && !error.toLowerCase().includes('cancel')) {
      Alert.alert('Purchase Failed', error);
    }
  }, [trackPurchaseOutcome]);

  // Listener callbacks are read through a ref so the billing setup effect
  // below runs exactly once: re-running it would call iapEnd() and tear down
  // the store connection (e.g. when the localized price arrives).
  const purchaseHandlersRef = useRef({
    success: handlePurchaseSuccess,
    error: handlePurchaseError,
    pending: handlePurchasePending,
    applyRestored: applyRestoredEntitlement,
    syncPrice: syncProductPrice,
  });
  useEffect(() => {
    purchaseHandlersRef.current = {
      success: handlePurchaseSuccess,
      error: handlePurchaseError,
      pending: handlePurchasePending,
      applyRestored: applyRestoredEntitlement,
      syncPrice: syncProductPrice,
    };
  }, [applyRestoredEntitlement, handlePurchaseError, handlePurchasePending, handlePurchaseSuccess, syncProductPrice]);

  // Mount: load cached status. Billing is NOT initialized eagerly on iOS
  // (getAvailablePurchases can show an Apple ID sheet). Android connects
  // silently after a short delay so purchases that completed while the app
  // was closed/offline get acknowledged — Google auto-refunds purchases left
  // unacknowledged for 3 days. Every failure here is silent (offline-first).
  useEffect(() => {
    let mounted = true;

    const loadPremiumStatus = async () => {
      try {
        const [storedPremium, storedActivation] = await Promise.all([
          AsyncStorage.getItem(PREMIUM_STORAGE_KEY),
          AsyncStorage.getItem(ACTIVATION_STORAGE_KEY),
        ]);
        if (!mounted) return;
        if (storedPremium !== null) {
          setIsPremium(JSON.parse(storedPremium));
        }
        if (storedActivation !== null) {
          setHasActivated(JSON.parse(storedActivation));
        }
      } catch {
        // Ignore load errors
      } finally {
        if (mounted) setIsLoading(false);
      }
    };

    const reconcileAndroidPurchases = async () => {
      try {
        // Connects + attaches listeners before fetching products, so even an
        // offline product fetch leaves a live purchase listener.
        const initResult = await iapInit();
        if (!mounted) return;
        if (initResult.ok && (initResult.products?.length ?? 0) > 0) {
          purchaseHandlersRef.current.syncPrice(initResult.products);
          setStoreStatus('ready');
        }
        if (!iapIsConnected()) return;
        await purchaseHandlersRef.current.applyRestored('startup_reconcile', false);
      } catch {
        // Offline / Play unavailable: retried on resume and on paywall open.
      }
    };

    // Register callbacks up front; listeners are attached when billing connects.
    setIapCallbacks(
      async (purchase) => {
        if (mounted) {
          await purchaseHandlersRef.current.success(purchase);
        }
      },
      (error, code) => {
        if (mounted) {
          purchaseHandlersRef.current.error(error, code);
        }
      },
      (purchase) => {
        if (mounted) {
          purchaseHandlersRef.current.pending(purchase);
        }
      }
    );

    void loadPremiumStatus();
    const reconcileTimer = Platform.OS === 'android'
      ? setTimeout(() => { void reconcileAndroidPurchases(); }, ANDROID_RECONCILE_DELAY_MS)
      : null;

    return () => {
      mounted = false;
      if (reconcileTimer) clearTimeout(reconcileTimer);
      setIapCallbacks(null, null, null);
      void iapEnd();
    };
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active') return;
      if (Platform.OS === 'ios') {
        // Only after the user has touched the store this session, and once.
        if (!iapIsInitialized() || resumeRestoreDoneRef.current) return;
        resumeRestoreDoneRef.current = true;
      } else if (!iapIsConnected()) {
        // Startup connect failed (offline): retry silently on each resume.
        void iapInit().then((result) => {
          if (result.ok) purchaseHandlersRef.current.syncPrice(result.products);
          if (!iapIsConnected()) return;
          return applyRestoredEntitlement('app_resume', false);
        }).catch(() => {});
        return;
      }

      void applyRestoredEntitlement('app_resume', false).catch((error) => {
        void analyticsService.trackRestorePurchaseFailed(error?.message ?? String(error));
      });
    });

    return () => subscription.remove();
  }, [applyRestoredEntitlement]);

  const markActivated = useCallback(() => {
    setHasActivated(true);
    AsyncStorage.setItem(ACTIVATION_STORAGE_KEY, JSON.stringify(true)).catch(() => {});
  }, []);

  const openUpgradeModal = useCallback((featureName?: string, options?: OpenUpgradeModalOptions) => {
    if (options?.trigger === 'automatic' && !isPremium && !hasActivated) {
      void analyticsService.trackPaywallSuppressed(featureName, 'pre_activation');
      Alert.alert(
        'Try Quo First',
        'Ask your first question and get an answer before upgrading.'
      );
      return;
    }

    setUpgradeFeatureTrigger(featureName || null);
    setShowUpgradeModal(true);
    if (featureName) {
      void analyticsService.trackPremiumFeatureTapped(featureName);
    }
    void analyticsService.trackPaywallOpened(featureName, featureName ? 'locked_feature' : 'manual');
    void analyticsService.trackPremiumScreenViewed(featureName, featureName ? 'locked_feature' : 'manual');
    void ensureStoreReady(true, 'paywall_opened');
  }, [ensureStoreReady, hasActivated, isPremium]);

  const closeUpgradeModal = useCallback(() => {
    void analyticsService.trackPaywallDismissed(upgradeFeatureTriggerRef.current);
    setShowUpgradeModal(false);
    setUpgradeFeatureTrigger(null);
  }, []);

  const restorePurchases = useCallback(async () => {
    if (isProcessingPurchase) return;
    setIsProcessingPurchase(true);
    void analyticsService.trackRestorePurchaseTapped();
    try {
      const storeReady = await ensureStoreReady(false, 'restore');
      if (!storeReady) {
        void analyticsService.trackRestorePurchaseFailed('store_unavailable');
        return;
      }

      await applyRestoredEntitlement('restore_button', true);
    } catch (e: any) {
      void analyticsService.trackRestorePurchaseFailed(e?.message ?? String(e));
      analyticsService.recordError(e, 'premium_restore_exception');
      Alert.alert('Restore Failed', 'Could not reach the store to restore purchases. Check your connection and try again.');
    } finally {
      setIsProcessingPurchase(false);
    }
  }, [applyRestoredEntitlement, ensureStoreReady, isProcessingPurchase]);

  const handleUpgrade = useCallback(async () => {
    if (isProcessingPurchase) return;
    const purchaseFeature = upgradeFeatureTriggerRef.current;
    purchaseFeatureRef.current = purchaseFeature;
    setIsProcessingPurchase(true);
    void analyticsService.trackPurchaseBuyTapped(purchaseFeature, productPrice);
    try {
      const storeReady = await ensureStoreReady(false, 'purchase');
      if (!storeReady) {
        setIsProcessingPurchase(false);
        trackPurchaseOutcome('failed', (featureName) => {
          void analyticsService.trackPurchaseFailed('store_unavailable', featureName, 'store_unavailable');
        });
        purchaseFeatureRef.current = null;
        return;
      }

      const purchaseResult = await iapPurchase(IAP_SKUS.PREMIUM_LIFETIME, purchaseFeature);
      if (!purchaseResult.ok) {
        setIsProcessingPurchase(false);
        if (purchaseResult.error) {
          // Don't show scary errors for user cancels
          if (purchaseResult.error.toLowerCase().includes('cancel')) {
            trackPurchaseOutcome('cancelled', (featureName) => {
              void analyticsService.trackPurchaseCancelled(featureName);
            });
          } else {
            trackPurchaseOutcome('failed', (featureName) => {
              void analyticsService.trackPurchaseFailed(purchaseResult.error, featureName, purchaseResult.code);
            });
            Alert.alert('Purchase Failed', purchaseResult.error);
          }
        } else {
          trackPurchaseOutcome('failed', (featureName) => {
            void analyticsService.trackPurchaseFailed('unknown_purchase_error', featureName, purchaseResult.code);
          });
        }
        return;
      }
      // Success is handled by purchaseUpdatedListener -> handlePurchaseSuccess
      // Don't reset isProcessingPurchase here; the listener will do it
    } catch (e: any) {
      setIsProcessingPurchase(false);
      trackPurchaseOutcome('failed', (featureName) => {
        void analyticsService.trackPurchaseFailed(e?.message ?? String(e), featureName, e?.code);
      });
      analyticsService.recordError(e, 'premium_purchase_exception');
      Alert.alert('Purchase Failed', e?.message ?? 'Could not complete purchase. Please try again.');
    }
  }, [ensureStoreReady, isProcessingPurchase, productPrice, trackPurchaseOutcome]);

  const checkPremiumFeature = useCallback((featureName: string): boolean => {
    if (isPremium) {
      return true;
    }
    openUpgradeModal(featureName);
    return false;
  }, [isPremium, openUpgradeModal]);

  return (
    <PremiumContext.Provider
      value={{
        isPremium,
        hasActivated,
        showUpgradeModal,
        upgradeFeatureTrigger,
        isLoading,
        isProcessingPurchase,
        productPrice,
        storeStatus,
        storeError,
        openUpgradeModal,
        closeUpgradeModal,
        handleUpgrade,
        restorePurchases,
        ensureStoreReady,
        checkPremiumFeature,
        markActivated,
      }}
    >
      {children}
    </PremiumContext.Provider>
  );
}

export function usePremium() {
  const context = useContext(PremiumContext);
  if (context === undefined) {
    throw new Error('usePremium must be used within a PremiumProvider');
  }
  return context;
}

