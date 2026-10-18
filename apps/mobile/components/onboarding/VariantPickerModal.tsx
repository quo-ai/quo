import React, { useEffect, useState } from 'react';
import { ModelExpectationHint } from '@/components/ModelExpectationHint';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Modal,
  Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X, Download, Check, Trash2, Lock } from 'lucide-react-native';
import { ModelConfig, DEFAULT_MODEL_ID } from '@/constants/models';
import { llmService } from '@/services/llm';
import { getModelMemoryVerdict, confirmMemoryThenProceed } from '@/utils/deviceCapability';
import { isBundledStarterAvailable } from '@/services/bundledModel';
import { spacing, borderRadius } from '@/constants/theme';
import { makeStyles, useTheme } from '@/hooks/useTheme';
import { FREE_TIER_LIMITS } from '@/contexts/PremiumContext';
import { isFreeTierModel } from '@/constants/premium';
import { ModelFamily } from '@/components/onboarding/modelGrouping';
import {
  PremiumBadge,
  DownloadedBadge,
  RecommendedBadge,
  FreeBadge,
  ActiveBadge,
} from '@/components/onboarding/Badges';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const isTablet = SCREEN_WIDTH >= 768;

interface VariantPickerModalProps {
  family: ModelFamily;
  downloadedModels: Set<string>;
  isDownloading: boolean;
  isLoading: boolean;
  isPremium: boolean;
  downloadingModelId: string | null;
  downloadProgress: number;
  onClose: () => void;
  onSelectModel: (model: ModelConfig) => void;
  onDeleteModel: (model: ModelConfig) => void;
}

// "Choose a Size" modal listing the variants of a model family
export function VariantPickerModal({
  family,
  downloadedModels,
  isDownloading,
  isLoading,
  isPremium,
  downloadingModelId,
  downloadProgress,
  onClose,
  onSelectModel,
  onDeleteModel,
}: VariantPickerModalProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const activeModelId = llmService.getCurrentModelId();
  const isProcessing = isDownloading || isLoading;

  const [starterBundled, setStarterBundled] = useState(false);

  useEffect(() => {
    isBundledStarterAvailable().then(setStarterBundled).catch(() => {});
  }, []);

  const handleVariantPress = (model: ModelConfig) => {
    // Locked models go straight to the paywall (handled by the parent) —
    // no point warning about memory for a model the user can't pick yet.
    if (!isPremium && !isFreeTierModel(model.id)) {
      onSelectModel(model);
      return;
    }
    confirmMemoryThenProceed(model, downloadedModels.has(model.id), () => onSelectModel(model));
  };

  return (
    <Modal
      visible={true}
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <View style={[styles.modalOverlay, { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.lg }]}>
        <View style={styles.modalContent}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Choose a Size</Text>
            <TouchableOpacity
              style={styles.modalCloseButton}
              onPress={onClose}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <X size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.modalScroll}
            showsVerticalScrollIndicator={false}
            overScrollMode="never"
          >
            {family.models.map((model) => {
              const isDownloaded = downloadedModels.has(model.id);
              const isCurrentlyDownloading = isDownloading && downloadingModelId === model.id;
              const isCurrentlyLoading = isLoading && downloadingModelId === model.id;
              const isActive = isCurrentlyDownloading || isCurrentlyLoading;
              const isSelectedModel = model.id === activeModelId;
              const isFreeModel = isFreeTierModel(model.id);
              const isLockedModel = !isPremium && !isFreeModel;
              const memoryVerdict = getModelMemoryVerdict(model.sizeBytes);

              return (
                <TouchableOpacity
                  key={model.id}
                  style={[
                    styles.variantCard,
                    isActive && styles.variantCardActive,
                    isLockedModel && styles.variantCardLocked,
                  ]}
                  onPress={() => handleVariantPress(model)}
                  disabled={isProcessing}
                  activeOpacity={0.7}
                >
                  <View style={styles.variantInfo}>
                    <View style={styles.variantHeader}>
                      <Text style={[styles.variantName, isLockedModel && styles.variantNameLocked]}>
                        {model.name}
                      </Text>
                      {isSelectedModel && isDownloaded && !isActive && <ActiveBadge />}
                      {model.id === 'qwen35-0.8b' && <RecommendedBadge />}
                      {isFreeModel && model.id !== FREE_TIER_LIMITS.STARTER_MODEL_ID && <FreeBadge />}
                      {isLockedModel && <PremiumBadge />}
                    </View>
                    <Text style={styles.variantDescription}>{model.description}</Text>
                    <ModelExpectationHint sizeBytes={model.sizeBytes} />
                    <View style={styles.variantMeta}>
                      <Text style={styles.variantSize}>{model.size}</Text>
                      {isDownloaded && !isActive && <DownloadedBadge checkSize={10} />}
                    </View>
                    {memoryVerdict !== 'ok' && (
                      <Text style={memoryVerdict === 'unsupported' ? styles.memoryWarningError : styles.memoryWarning}>
                        {memoryVerdict === 'unsupported'
                          ? "Exceeds this device's memory — may crash"
                          : 'May be unstable on this device'}
                      </Text>
                    )}

                    {isActive && (
                      <View style={styles.progressContainer}>
                        <View style={styles.progressTrack}>
                          <View style={[styles.progressBar, { width: `${Math.min(downloadProgress, 100)}%` }]} />
                        </View>
                        <Text style={styles.progressText}>
                          {Math.min(Math.round(downloadProgress), 100)}%
                        </Text>
                      </View>
                    )}
                  </View>

                  <View style={styles.variantAction}>
                    {isLockedModel ? (
                      <Lock size={18} color={colors.secondary} />
                    ) : isActive ? (
                      <ActivityIndicator size="small" color={colors.primary} />
                    ) : isDownloaded && starterBundled && model.id === DEFAULT_MODEL_ID ? (
                      // The bundled starter ships inside the app — deleting
                      // it frees nothing, so no delete affordance.
                      <Check size={20} color={colors.success} />
                    ) : isDownloaded ? (
                      <View style={styles.variantActionsRow}>
                        <TouchableOpacity
                          style={styles.deleteIconButton}
                          onPress={(e) => {
                            e.stopPropagation();
                            onDeleteModel(model);
                          }}
                          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                        >
                          <Trash2 size={18} color={colors.textTertiary} />
                        </TouchableOpacity>
                        <Check size={20} color={colors.success} />
                      </View>
                    ) : (
                      <Download size={20} color={colors.primary} />
                    )}
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  modalOverlay: {
    flex: 1,
    backgroundColor: colors.scrim,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  modalContent: {
    width: '100%',
    maxWidth: isTablet ? 500 : 400,
    maxHeight: '80%',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    overflow: 'hidden',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.glassBorder,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  modalCloseButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.glassStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalScroll: {
    padding: spacing.md,
  },
  variantCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.glassMedium,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  variantCardActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryMuted,
  },
  variantCardLocked: {
    borderColor: colors.secondaryGlow,
    backgroundColor: colors.secondaryMuted,
  },
  variantInfo: {
    flex: 1,
  },
  variantHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: 4,
  },
  variantName: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  variantNameLocked: {
    color: colors.textSecondary,
  },
  variantDescription: {
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  variantMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  variantSize: {
    fontSize: 12,
    color: colors.textTertiary,
  },
  memoryWarning: {
    marginTop: spacing.xs,
    fontSize: 11,
    color: colors.warning,
  },
  memoryWarningError: {
    marginTop: spacing.xs,
    fontSize: 11,
    color: colors.error,
  },
  variantAction: {
    marginLeft: spacing.md,
  },
  variantActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  deleteIconButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.glassStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  progressTrack: {
    flex: 1,
    height: 4,
    backgroundColor: colors.glassStrong,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: 2,
  },
  progressText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.primary,
    minWidth: 40,
    textAlign: 'right',
  },
}));
