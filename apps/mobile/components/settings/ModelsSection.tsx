import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { Brain, Plus } from 'lucide-react-native';
import { PREMIUM_FEATURES, FREE_TIER_LIMITS } from '@/contexts/PremiumContext';
import { useChat } from '@/contexts/ChatContext';
import { isFreeTierModel } from '@/constants/premium';
import { compareModelsBySize } from '@/components/onboarding/modelGrouping';
import { AVAILABLE_MODELS, ModelConfig, DEFAULT_MODEL_ID } from '@/constants/models';
import { isBundledStarterAvailable } from '@/services/bundledModel';
import { customModelService, CustomModelConfig } from '@/services/customModelService';
import { llmService } from '@/services/llm';
import { downloadService } from '@/services/downloadService';
import { AppSettings } from '@/types/chat';
import { confirmMemoryThenProceed } from '@/utils/deviceCapability';
import { spacing, borderRadius, typography } from '@/constants/theme';
import { makeStyles, useTheme } from '@/hooks/useTheme';
import { AddCustomModelModal } from './AddCustomModelModal';
import { ModelRow } from './ModelRow';
import { useModelDownloadStatus } from './useModelDownloadStatus';
import { settingsStyles } from './styles';

type AnyModel = ModelConfig | CustomModelConfig;

interface ModelsSectionProps {
  settings: AppSettings;
  updateSettings: (settings: Partial<AppSettings>) => void;
  modelLoaded: boolean;
  /** Kept for API compatibility; model switches go through useChat().selectModel. */
  loadModel?: () => Promise<boolean>;
  isPremium: boolean;
  checkPremiumFeature: (featureName: string) => boolean;
}

export function ModelsSection({
  settings,
  updateSettings,
  modelLoaded,
  isPremium,
  checkPremiumFeature,
}: ModelsSectionProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const { isGenerating, stopGeneration, selectModel, handleModelDeleted } = useChat();
  const {
    statusById,
    progressById,
    customModels,
    refresh,
    setStatus,
    setProgress,
  } = useModelDownloadStatus();
  // Model being switched to; settings.modelId only changes once it loaded.
  const [switchingModelId, setSwitchingModelId] = useState<string | null>(null);
  const [showAddCustomModel, setShowAddCustomModel] = useState(false);
  const sortedBuiltInModels = React.useMemo(() => {
    return [...AVAILABLE_MODELS].sort(compareModelsBySize);
  }, []);
  const sortedCustomModels = React.useMemo(() => {
    return [...customModels].sort(compareModelsBySize);
  }, [customModels]);

  const [starterBundled, setStarterBundled] = useState(false);

  useEffect(() => {
    isBundledStarterAvailable().then(setStarterBundled).catch(() => {});
  }, []);

  const handleCustomModelAdded = async (model: CustomModelConfig) => {
    setShowAddCustomModel(false);

    // Refresh custom models list
    await refresh();

    // Ask to download
    Alert.alert(
      'Model Added',
      `${model.name} has been added. Would you like to download it now?`,
      [
        { text: 'Later', style: 'cancel' },
        {
          text: 'Download',
          onPress: () => handleDownloadModel(model),
        },
      ]
    );
  };

  // Delete a model's files (and, for custom models, its catalog entry). A
  // generation using it is stopped first; if it was the active model, the
  // chat context switches to another downloaded model.
  const deleteModel = async (model: AnyModel, isCustom: boolean) => {
    const isActive = llmService.getCurrentModelId() === model.id || llmService.isModelCurrentlyLoaded(model.id);
    if (isActive && isGenerating) {
      await stopGeneration();
    }
    await llmService.deleteModelById(model.id);
    if (isCustom) {
      await customModelService.removeModel(model.id);
      setStatus(model.id, null);
    } else {
      setStatus(model.id, 'not_downloaded');
    }
    await handleModelDeleted(model.id);
    await refresh();
  };

  const handleDeleteCustomModel = (model: CustomModelConfig) => {
    const isActive = settings.modelId === model.id && modelLoaded;
    const message = isActive
      ? `This will unload and remove ${model.name} and its downloaded file from your device.`
      : `This will remove ${model.name} and its downloaded file from your device.`;

    Alert.alert(
      `Delete ${model.name}?`,
      message,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteModel(model, true);
              Alert.alert('Model Deleted', `${model.name} has been removed.`);
            } catch (error) {
              console.error('Error deleting model:', error);
              Alert.alert('Error', 'Failed to delete the model. Please try again.');
            }
          },
        },
      ]
    );
  };

  const handleDownloadModel = (model: AnyModel) => {
    if (statusById[model.id] === 'downloading') return;

    // One download at a time: say so instead of starting (and failing) a
    // second one with a misleading network error.
    if (downloadService.isBusy()) {
      const busyName = downloadService.getState().modelName;
      Alert.alert(
        'Another download is in progress',
        `${busyName ? `${busyName} is` : 'Another model is'} still downloading. Wait for it to finish or cancel it first.`,
      );
      return;
    }

    Alert.alert(
      `Download ${model.name}?`,
      `This will download ${model.size} to your device for offline use.${model.hasVision ? '\n\nThis model supports vision (image analysis).' : ''}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Download',
          onPress: async () => {
            setStatus(model.id, 'downloading');
            setProgress(model.id, 0);

            // Use downloadService for downloads (handles notifications)
            const success = await downloadService.startDownload(model, (progress) => {
              setProgress(model.id, progress);
            });

            if (success) {
              // Vision projector only after the main weights landed.
              const mmprojSuccess = model.hasVision && model.mmprojUrl
                ? await llmService.downloadMmproj(undefined, model)
                : true;
              if (!mmprojSuccess) {
                setStatus(model.id, 'not_downloaded');
                Alert.alert('Download Failed', 'The model downloaded, but vision support failed to download. Please try again.');
                return;
              }

              setStatus(model.id, 'downloaded');

              // Ask user if they want to switch to this model now
              Alert.alert(
                'Download Complete',
                `${model.name} is ready. Would you like to use it now?`,
                [
                  { text: 'Later', style: 'cancel' },
                  {
                    text: 'Use Now',
                    onPress: () => handleSelectModel(model),
                  },
                ]
              );
            } else {
              await refresh();
              const state = downloadService.getState();
              // Cancelled by the user: nothing to report.
              if (state.status === 'idle') return;
              Alert.alert('Download Failed', state.error || 'The download did not complete. Please try again.');
            }
          },
        },
      ]
    );
  };

  const confirmMemoryThenSelect = (model: AnyModel) => {
    confirmMemoryThenProceed(model, statusById[model.id] === 'downloaded', () => {
      void handleSelectModel(model);
    });
  };

  const handleSelectModel = async (model: AnyModel) => {
    // Verify model exists on disk (more reliable than state)
    const modelExists = await llmService.checkModelExists(model.id);

    if (!modelExists) {
      // Update state to reflect reality
      setStatus(model.id, 'not_downloaded');
      handleDownloadModel(model);
      return;
    }

    // Don't switch if already selected and loaded
    if (settings.modelId === model.id && modelLoaded) {
      return;
    }

    // Don't allow switching while loading
    if (switchingModelId) {
      return;
    }

    setSwitchingModelId(model.id);

    try {
      // Unloading the current model mid-reply would pull the context out
      // from under the generation loop.
      if (isGenerating) {
        await stopGeneration();
      }

      // settings.modelId is persisted only after the load succeeds, so a
      // model that crashes the app on load can't become a launch loop.
      const success = await selectModel(model.id);

      if (success) {
        Alert.alert('Model Loaded', `${model.name} is now active and ready to use.`);
      } else {
        Alert.alert('Error', 'Failed to load the model. Please try again.');
      }
    } catch (error) {
      console.error('Error switching model:', error);
      Alert.alert('Error', 'Failed to load the model. Please try again.');
    } finally {
      setSwitchingModelId(null);
    }
  };

  const handleDeleteModel = (model: ModelConfig) => {
    const isActive = settings.modelId === model.id && modelLoaded;
    const message = isActive
      ? `This will unload and remove ${model.name} (${model.size}) from your device. You can re-download it later.`
      : `This will remove ${model.name} (${model.size}) from your device. You can re-download it later.`;

    Alert.alert(
      `Delete ${model.name}?`,
      message,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteModel(model, false);
              Alert.alert('Model Deleted', `${model.name} has been removed from your device.`);
            } catch (error) {
              console.error('Error deleting model:', error);
              Alert.alert('Error', 'Failed to delete the model. Please try again.');
            }
          },
        },
      ]
    );
  };

  const isSwitching = switchingModelId !== null;

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Models</Text>
      <Text style={styles.sectionDescription}>
        Select a model to use. Models are downloaded once for offline use.
      </Text>

      <View style={styles.card}>
        {sortedBuiltInModels.map((model) => {
          const isSelected = settings.modelId === model.id;
          const isDownloaded = statusById[model.id] === 'downloaded';
          const isFreeModel = isFreeTierModel(model.id);
          const isLockedModel = !isPremium && !isFreeModel;

          return (
            <ModelRow
              key={model.id}
              model={model}
              status={statusById[model.id]}
              progress={progressById[model.id] || 0}
              isSelected={isSelected}
              isLocked={isLockedModel}
              modelLoaded={modelLoaded}
              isSwitching={isSwitching}
              isSwitchingToThis={switchingModelId === model.id}
              // The bundled starter ships inside the app — deleting it
              // frees nothing, so hide the delete affordance. Locked models
              // stay deletable so a lapsed premium user can free the space.
              canDelete={isDownloaded && !(starterBundled && model.id === DEFAULT_MODEL_ID)}
              onPress={() => {
                if (isLockedModel) {
                  checkPremiumFeature(PREMIUM_FEATURES.EXTRA_MODELS);
                  return;
                }
                confirmMemoryThenSelect(model);
              }}
              onDelete={() => handleDeleteModel(model)}
              badges={
                <>
                  {model.id === 'qwen35-0.8b' && (
                    <View style={styles.recommendedBadge}>
                      <Text style={styles.recommendedBadgeText}>Recommended</Text>
                    </View>
                  )}
                  {isFreeModel && model.id !== FREE_TIER_LIMITS.STARTER_MODEL_ID && (
                    <View style={styles.freeBadge}>
                      <Text style={styles.freeBadgeText}>Free</Text>
                    </View>
                  )}
                  {!isLockedModel && model.id === 'smollm3-3b' && (
                    <View style={styles.fastestBadge}>
                      <Text style={styles.fastestBadgeText}>Compact</Text>
                    </View>
                  )}
                </>
              }
            >
              {/* Thinking Mode Toggle - Only for models that support thinking */}
              {isSelected && isDownloaded && model.features.includes('thinking') && (
                <TouchableOpacity
                  style={styles.thinkingToggle}
                  onPress={(e) => {
                    e.stopPropagation();
                    // Gate thinking mode behind premium
                    if (!settings.enableThinking && !checkPremiumFeature(PREMIUM_FEATURES.THINKING_MODE)) {
                      return;
                    }
                    updateSettings({ enableThinking: !settings.enableThinking });
                  }}
                  activeOpacity={0.7}
                >
                  <Brain size={14} color={settings.enableThinking ? colors.secondary : colors.textTertiary} />
                  <Text style={[styles.thinkingToggleText, settings.enableThinking && styles.thinkingToggleTextActive]}>
                    Think first · slower, more careful
                  </Text>
                  <View style={[styles.miniSwitch, settings.enableThinking && styles.miniSwitchActive]}>
                    <View style={[styles.miniSwitchThumb, settings.enableThinking && styles.miniSwitchThumbActive]} />
                  </View>
                </TouchableOpacity>
              )}
            </ModelRow>
          );
        })}
      </View>

      {/* Custom Models Section */}
      {sortedCustomModels.length > 0 && (
        <View style={[styles.card, { marginTop: spacing.md }]}>
          {sortedCustomModels.map((model) => {
            const isLockedModel = !isPremium;
            return (
              <ModelRow
                key={model.id}
                model={model}
                status={statusById[model.id]}
                progress={progressById[model.id] || 0}
                isSelected={settings.modelId === model.id}
                isLocked={isLockedModel}
                isCustom
                modelLoaded={modelLoaded}
                isSwitching={isSwitching}
                isSwitchingToThis={switchingModelId === model.id}
                // Always deletable — including after a premium lapse locks it.
                canDelete
                onPress={() => {
                  if (isLockedModel) {
                    checkPremiumFeature(PREMIUM_FEATURES.CUSTOM_MODELS);
                    return;
                  }
                  confirmMemoryThenSelect(model);
                }}
                onDelete={() => handleDeleteCustomModel(model)}
              />
            );
          })}
        </View>
      )}

      {/* Add Custom Model Button */}
      <TouchableOpacity
        style={styles.addCustomModelButton}
        onPress={() => {
          // Gate custom models behind premium
          if (!checkPremiumFeature(PREMIUM_FEATURES.CUSTOM_MODELS)) {
            return;
          }
          setShowAddCustomModel(true);
        }}
        activeOpacity={0.7}
      >
        <Plus size={20} color={colors.primary} />
        <Text style={styles.addCustomModelText}>Add Custom Model</Text>
      </TouchableOpacity>

      {/* Add Custom Model Modal */}
      <AddCustomModelModal
        visible={showAddCustomModel}
        onClose={() => setShowAddCustomModel(false)}
        onModelAdded={handleCustomModelAdded}
      />
    </View>
  );
}

const useStyles = makeStyles((theme) => {
  const { colors } = theme;
  return {
    ...settingsStyles(theme),
    recommendedBadge: {
      backgroundColor: colors.primaryMuted,
      paddingHorizontal: spacing.sm,
      paddingVertical: 2,
      borderRadius: borderRadius.sm,
    },
    recommendedBadgeText: {
      fontSize: typography.sizes.xs,
      fontWeight: typography.weights.semibold,
      color: colors.primary,
    },
    fastestBadge: {
      backgroundColor: colors.warningMuted,
      paddingHorizontal: spacing.sm,
      paddingVertical: 2,
      borderRadius: borderRadius.sm,
    },
    fastestBadgeText: {
      fontSize: typography.sizes.xs,
      fontWeight: typography.weights.semibold,
      color: colors.warning,
    },
    freeBadge: {
      backgroundColor: colors.successMuted,
      paddingHorizontal: spacing.sm,
      paddingVertical: 2,
      borderRadius: borderRadius.sm,
    },
    freeBadgeText: {
      fontSize: typography.sizes.xs,
      fontWeight: typography.weights.semibold,
      color: colors.success,
    },
    // Thinking toggle styles
    thinkingToggle: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      marginTop: spacing.sm,
      paddingVertical: spacing.xs,
      paddingHorizontal: spacing.sm,
      backgroundColor: colors.glass,
      borderRadius: borderRadius.lg,
      borderWidth: 1,
      borderColor: colors.glassBorder,
    },
    thinkingToggleText: {
      flex: 1,
      fontSize: 13,
      color: colors.textTertiary,
    },
    thinkingToggleTextActive: {
      color: colors.secondary,
    },
    addCustomModelButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      marginTop: spacing.md,
      paddingVertical: spacing.md,
      backgroundColor: colors.glassMedium,
      borderRadius: borderRadius.xl,
      borderWidth: 1,
      borderColor: colors.glassBorder,
      borderStyle: 'dashed',
    },
    addCustomModelText: {
      fontSize: typography.sizes.md,
      fontWeight: typography.weights.medium,
      color: colors.primary,
    },
  };
});
