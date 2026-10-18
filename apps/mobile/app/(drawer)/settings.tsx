import React from 'react';
import { View, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useChat } from '@/contexts/ChatContext';
import { usePremium } from '@/contexts/PremiumContext';
import { ScreenHeader } from '@/components/ScreenHeader';
import { PremiumStatusHeader } from '@/components/settings/PremiumStatusHeader';
import { AppearanceSection } from '@/components/settings/AppearanceSection';
import { ModelsSection } from '@/components/settings/ModelsSection';
import { VoiceInputSection } from '@/components/settings/VoiceInputSection';
import { IntelligenceSection } from '@/components/settings/IntelligenceSection';
import { MemorySection } from '@/components/settings/MemorySection';
import { SyncSection } from '@/components/settings/SyncSection';
import { AdvancedSection } from '@/components/settings/AdvancedSection';
import { DataSection } from '@/components/settings/DataSection';
import { AboutSection } from '@/components/settings/AboutSection';
import { spacing } from '@/constants/theme';
import { makeStyles } from '@/hooks/useTheme';

export default function SettingsScreen() {
  const { settings, updateSettings, clearAllChats, modelLoaded, loadModel } = useChat();
  const {
    isPremium,
    hasActivated,
    openUpgradeModal,
    checkPremiumFeature,
    restorePurchases,
    isProcessingPurchase,
  } = usePremium();
  const insets = useSafeAreaInsets();
  const styles = useStyles();

  return (
    <View style={styles.container}>
      <ScreenHeader title="Settings" showBorder />

      <ScrollView style={styles.scrollView} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xxl }]}>
        <PremiumStatusHeader
          isPremium={isPremium}
          hasActivated={hasActivated}
          openUpgradeModal={openUpgradeModal}
          restorePurchases={restorePurchases}
          isProcessingPurchase={isProcessingPurchase}
        />

        <AppearanceSection />

        <ModelsSection
          settings={settings}
          updateSettings={updateSettings}
          modelLoaded={modelLoaded}
          loadModel={loadModel}
          isPremium={isPremium}
          checkPremiumFeature={checkPremiumFeature}
        />

        <VoiceInputSection
          isPremium={isPremium}
          checkPremiumFeature={checkPremiumFeature}
        />

        <IntelligenceSection
          settings={settings}
          updateSettings={updateSettings}
          isPremium={isPremium}
          checkPremiumFeature={checkPremiumFeature}
        />

        <MemorySection isPremium={isPremium} />

        <SyncSection />

        <AdvancedSection settings={settings} updateSettings={updateSettings} />

        <DataSection clearAllChats={clearAllChats} />

        <AboutSection />
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: spacing.lg,
  },
}));
