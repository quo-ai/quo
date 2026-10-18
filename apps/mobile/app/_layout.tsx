import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ChatProvider, useChat } from '@/contexts/ChatContext';
import { PremiumProvider, usePremium } from '@/contexts/PremiumContext';
import { ModelSelectionScreen } from '@/components/ModelSelectionScreen';
import { ModelConfig } from '@/constants/models';
import { AppLoading } from '@/components/AppLoading';
import { UpgradeModal } from '@/components/UpgradeModal';
import { analyticsService } from '@/services/analyticsService';
import { resolveAnalyticsRegion } from '@/services/analyticsRegion';
import { getPhaseDisplayProgress } from '@/utils/modelProgress';
import { ThemeProvider, useTheme } from '@/hooks/useTheme';

// Before anything tracks: the consent decision uses the store country.
analyticsService.setRegionResolver(resolveAnalyticsRegion);

function AppContent() {
  const {
    isLoading,
    showModelSelection,
    modelLoadProgress,
    modelStatus,
    modelError,
    downloadingModelId,
    startDownloadForModel
  } = useChat();
  const {
    showUpgradeModal,
    closeUpgradeModal,
    handleUpgrade,
    upgradeFeatureTrigger,
    restorePurchases,
    isProcessingPurchase,
    openUpgradeModal,
    productPrice,
    storeStatus,
    storeError,
  } = usePremium();

  const { colors } = useTheme();

  const handleModelSelected = (model: ModelConfig) => {
    startDownloadForModel(model.id);
  };

  // Only show loading screen during initial app load (loading conversations/settings)
  // Model switching happens in the background while user stays in the app
  if (isLoading) {
    return <AppLoading />;
  }

  return (
    <>
      {showModelSelection ? (
        <ModelSelectionScreen
          onModelSelected={handleModelSelected}
          downloadProgress={getPhaseDisplayProgress(modelStatus, modelLoadProgress)}
          isDownloading={modelStatus === 'downloading'}
          isLoading={modelStatus === 'loading'}
          downloadingModelId={downloadingModelId}
          error={modelError}
          onUpgrade={(featureName) => openUpgradeModal(featureName)}
        />
      ) : (
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
          <Stack.Screen name="(drawer)" />
          <Stack.Screen name="+not-found" />
        </Stack>
      )}
      <UpgradeModal
        visible={showUpgradeModal}
        onClose={closeUpgradeModal}
        onUpgrade={handleUpgrade}
        onRestore={restorePurchases}
        isProcessingPurchase={isProcessingPurchase}
        featureTriggered={upgradeFeatureTrigger || undefined}
        productPrice={productPrice}
        storeStatus={storeStatus}
        storeError={storeError}
      />
    </>
  );
}

export default function RootLayout() {
  useEffect(() => {
    void analyticsService.trackAppJsMounted();
    void analyticsService.initialize();
    void analyticsService.trackAppOpened();
  }, []);

  return (
    <ThemeProvider>
      <PremiumProvider>
        <ChatProvider>
          <AppContent />
          {/* auto: dark icons on the light theme, light icons on dark */}
          <StatusBar style="auto" />
        </ChatProvider>
      </PremiumProvider>
    </ThemeProvider>
  );
}
