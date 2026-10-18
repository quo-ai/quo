import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  Alert,
  Dimensions,
  TouchableOpacity,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AVAILABLE_MODELS, ModelConfig } from '@/constants/models';
import { llmService } from '@/services/llm';
import { spacing, borderRadius } from '@/constants/theme';
import { makeStyles } from '@/hooks/useTheme';
import { QuoLogo } from '@/components/brand/QuoLogo';
import { usePremium, FREE_TIER_LIMITS, PREMIUM_FEATURES } from '@/contexts/PremiumContext';
import { useChat } from '@/contexts/ChatContext';
import { isFreeTierModel } from '@/constants/premium';
import { analyticsService } from '@/services/analyticsService';
import {
  ModelFamily,
  getModelFamilies,
  isFamilyLocked,
  familyHasDownloadedModel,
  sortFamiliesByLocked,
} from '@/components/onboarding/modelGrouping';
import { StarterSetupPanel } from '@/components/onboarding/StarterSetupPanel';
import { DownloadStatusBanner } from '@/components/onboarding/DownloadStatusBanner';
import { FamilyCard } from '@/components/onboarding/FamilyCard';
import { VariantPickerModal } from '@/components/onboarding/VariantPickerModal';
import { UpgradeCard } from '@/components/onboarding/UpgradeCard';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const isTablet = SCREEN_WIDTH >= 768;

interface ModelSelectionScreenProps {
  onModelSelected: (model: ModelConfig) => void;
  downloadProgress: number;
  isDownloading: boolean;
  isLoading?: boolean;
  downloadingModelId: string | null;
  error?: string | null;
  onUpgrade?: (featureName?: string) => void;
}

export function ModelSelectionScreen({
  onModelSelected,
  downloadProgress,
  isDownloading,
  isLoading = false,
  downloadingModelId,
  error,
  onUpgrade,
}: ModelSelectionScreenProps) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const { isPremium, productPrice } = usePremium();
  const { isGenerating, stopGeneration, handleModelDeleted } = useChat();
  // Last model the user picked, so the error banner can retry it.
  const [lastSelectedModel, setLastSelectedModel] = useState<ModelConfig | null>(null);
  const [downloadedModels, setDownloadedModels] = useState<Set<string>>(new Set());
  const [selectedFamily, setSelectedFamily] = useState<ModelFamily | null>(null);
  const [modelFamilies] = useState<ModelFamily[]>(getModelFamilies());
  const starterModel = AVAILABLE_MODELS.find(m => m.id === FREE_TIER_LIMITS.STARTER_MODEL_ID) || AVAILABLE_MODELS[0];

  const checkDownloadedModels = async () => {
    const exists = await Promise.all(AVAILABLE_MODELS.map(model => llmService.checkModelExists(model.id)));
    setDownloadedModels(new Set(AVAILABLE_MODELS.filter((_, i) => exists[i]).map(model => model.id)));
  };

  useEffect(() => {
    checkDownloadedModels();
    void analyticsService.trackFirstRunScreenShown('starter_setup', FREE_TIER_LIMITS.STARTER_MODEL_ID);
    void analyticsService.trackOnboardingStarted('starter_fast', FREE_TIER_LIMITS.STARTER_MODEL_ID);
    void analyticsService.setUserProperties({
      starter_model_id: FREE_TIER_LIMITS.STARTER_MODEL_ID,
      has_downloaded_model: false,
      activated_status: 'not_activated',
    });
  }, []);

  // Re-check downloaded models when download/loading state changes
  useEffect(() => {
    if (!isDownloading && !isLoading && downloadingModelId) {
      // A download just completed, refresh the list
      checkDownloadedModels();
    }
  }, [isDownloading, isLoading, downloadingModelId]);

  // Check if any operation is in progress
  const isProcessing = isDownloading || isLoading;
  const showStarterSetup = !isPremium && downloadedModels.size === 0;

  const handleStarterSetupPress = () => {
    if (isProcessing) return;

    void analyticsService.trackFirstRunCtaTapped(starterModel.id, starterModel.sizeBytes);
    void analyticsService.trackStarterModelSelected(starterModel.id, 'first_run_starter_setup', isPremium);
    setLastSelectedModel(starterModel);
    onModelSelected(starterModel);
  };

  const sortedFamilies = sortFamiliesByLocked(modelFamilies, isPremium);

  // Handle family card press
  const handleFamilyPress = (family: ModelFamily) => {
    if (family.id === 'custom') {
      if (downloadedModels.size === 0) {
        Alert.alert('Download Required', 'Please download an initial model first, like Qwen 3.5, to initialize the system before using custom models.');
        return;
      }
      if (!isPremium) {
        if (onUpgrade) onUpgrade(PREMIUM_FEATURES.CUSTOM_MODELS);
        return;
      }
      Alert.alert('Custom Models', 'You can load your own custom GGUF models directly from the Settings tab.');
      return;
    }

    if (isFamilyLocked(family, isPremium) && onUpgrade) {
      onUpgrade(PREMIUM_FEATURES.EXTRA_MODELS);
    } else {
      setSelectedFamily(family);
    }
  };

  // Handle model selection from variant picker
  const handleModelSelect = async (model: ModelConfig) => {
    const isFreeModel = isFreeTierModel(model.id);
    const isLockedModel = !isPremium && !isFreeModel;

    if (isLockedModel && onUpgrade) {
      setSelectedFamily(null);
      setTimeout(() => {
        onUpgrade(PREMIUM_FEATURES.EXTRA_MODELS);
      }, 300);
    } else {
      void analyticsService.trackStarterModelSelected(model.id, 'first_run_model_picker', isPremium);
      setSelectedFamily(null);
      // Switching models unloads the current one — stop any reply first.
      if (isGenerating) await stopGeneration();
      setLastSelectedModel(model);
      onModelSelected(model);
    }
  };

  const handleDeleteModel = async (model: ModelConfig) => {
    if (isProcessing) return;

    Alert.alert(
      'Delete Model?',
      `Remove ${model.name} from this device? You can download it again anytime.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              const isActive = llmService.getCurrentModelId() === model.id || llmService.isModelCurrentlyLoaded(model.id);
              if (isActive && isGenerating) await stopGeneration();
              await llmService.deleteModelById(model.id);
              // Switches off the model if it was the active one.
              await handleModelDeleted(model.id);
              await checkDownloadedModels();
            } catch (e: any) {
              Alert.alert('Delete Failed', e?.message ?? 'Could not delete the model.');
            }
          },
        },
      ]
    );
  };

  if (showStarterSetup) {
    return (
      <StarterSetupPanel
        starterModel={starterModel}
        isDownloading={isDownloading}
        isLoading={isLoading}
        downloadProgress={downloadProgress}
        error={error}
        onPress={handleStarterSetupPress}
      />
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View style={styles.logoRow}>
          <QuoLogo size={isTablet ? 80 : 64} />
          <Text style={styles.brandName}></Text>
        </View>
        <Text style={styles.title}>{isPremium ? 'Pick Your AI Model' : 'Start With Fast Offline AI'}</Text>
        <Text style={styles.subtitle}>
          Download the starter model once, then chat offline.
        </Text>
      </View>

      {/* Download/load failure — the starter panel has its own; this is the
          full picker's. */}
      {!!error && !isProcessing && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={() => onModelSelected(lastSelectedModel ?? starterModel)}
            activeOpacity={0.7}
          >
            <Text style={styles.retryButtonText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Download Progress Indicator */}
      {isProcessing && downloadingModelId && (
        <DownloadStatusBanner
          downloadingModelId={downloadingModelId}
          isDownloading={isDownloading}
          isLoading={isLoading}
          downloadProgress={downloadProgress}
        />
      )}

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {sortedFamilies.map((family) => (
          <FamilyCard
            key={family.id}
            family={family}
            isLocked={isFamilyLocked(family, isPremium)}
            hasDownloaded={familyHasDownloadedModel(family, downloadedModels)}
            disabled={isProcessing}
            onPress={handleFamilyPress}
          />
        ))}

        {!isPremium && onUpgrade && (
          <UpgradeCard
            productPrice={productPrice}
            onPress={() => onUpgrade(PREMIUM_FEATURES.EXTRA_MODELS)}
          />
        )}

      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.lg }]}>
        <Text style={styles.footerText}>
          Works offline. All processing happens on device.
        </Text>
      </View>

      {selectedFamily && (
        <VariantPickerModal
          family={selectedFamily}
          downloadedModels={downloadedModels}
          isDownloading={isDownloading}
          isLoading={isLoading}
          isPremium={isPremium}
          downloadingModelId={downloadingModelId}
          downloadProgress={downloadProgress}
          onClose={() => setSelectedFamily(null)}
          onSelectModel={handleModelSelect}
          onDeleteModel={handleDeleteModel}
        />
      )}
    </View>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.lg,
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  brandName: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  title: {
    fontSize: isTablet ? 28 : 24,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: isTablet ? 16 : 15,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: isTablet ? 24 : 22,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.lg,
    paddingHorizontal: isTablet ? spacing.xl : spacing.lg,
    paddingBottom: spacing.xxxl,
    gap: spacing.md,
  },
  footer: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.glassBorder,
  },
  footerText: {
    fontSize: 13,
    color: colors.textTertiary,
    textAlign: 'center',
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginHorizontal: isTablet ? spacing.xl : spacing.lg,
    marginBottom: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.errorMuted,
    borderWidth: 1,
    borderColor: colors.errorBorder,
    borderRadius: borderRadius.md,
  },
  errorText: {
    flex: 1,
    fontSize: 13,
    color: colors.error,
    lineHeight: 18,
  },
  retryButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.error,
  },
  retryButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.error,
  },
}));
