import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  ActivityIndicator,
  ScrollView,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X, Download, Check, Mic, Trash2, Lock } from 'lucide-react-native';
import { spacing, borderRadius } from '@/constants/theme';
import { makeStyles, useTheme } from '@/hooks/useTheme';
import { whisperService, WHISPER_MODELS, WhisperModelConfig } from '@/services/whisperService';
import { usePremium, PREMIUM_FEATURES } from '@/contexts/PremiumContext';
import { hasRemainingTrialUses } from '@/services/trialService';

interface VoiceModelModalProps {
  visible: boolean;
  onClose: () => void;
  onModelReady: () => void;
}

export function VoiceModelModal({ visible, onClose, onModelReady }: VoiceModelModalProps) {
  const { isPremium, checkPremiumFeature } = usePremium();
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const [modelStatus, setModelStatus] = useState<Record<string, 'idle' | 'downloading' | 'downloaded'>>({});
  const [downloadProgress, setDownloadProgress] = useState<Record<string, number>>({});
  const horizontalPadding = windowWidth <= 360 ? spacing.md : spacing.xl;
  const verticalPadding = spacing.xl;
  // Floor the bottom inset so content never touches the screen edge on
  // devices with no home indicator (e.g. iPhone SE reports insets.bottom=0).
  const bottomSafePadding = Math.max(insets.bottom, Platform.OS === 'android' ? 36 : spacing.md);
  const modalWidth = Math.min(420, Math.max(1, windowWidth - horizontalPadding * 2));
  const modalMaxHeight = Math.max(
    1,
    windowHeight - insets.top - bottomSafePadding - verticalPadding * 2
  );

  const checkStatus = useCallback(async () => {
    const status: Record<string, 'idle' | 'downloaded'> = {};
    for (const model of WHISPER_MODELS) {
      const downloaded = await whisperService.isModelDownloaded(model.id);
      status[model.id] = downloaded ? 'downloaded' : 'idle';
    }
    setModelStatus(status);
  }, []);

  useEffect(() => {
    if (visible) {
      checkStatus();
    }
  }, [visible, checkStatus]);

  const handleDownload = async (model: WhisperModelConfig) => {
    // Free users may proceed while they still have voice trial uses left.
    if (!isPremium && !(await hasRemainingTrialUses(PREMIUM_FEATURES.VOICE_INPUT))) {
      checkPremiumFeature(PREMIUM_FEATURES.VOICE_INPUT);
      return;
    }

    if (modelStatus[model.id] === 'downloading') return;

    setModelStatus(prev => ({ ...prev, [model.id]: 'downloading' }));
    setDownloadProgress(prev => ({ ...prev, [model.id]: 0 }));

    whisperService.setCurrentModel(model.id);
    const success = await whisperService.downloadModel(model.id, (progress) => {
      setDownloadProgress(prev => ({ ...prev, [model.id]: progress }));
    });

    if (success) {
      setModelStatus(prev => ({ ...prev, [model.id]: 'downloaded' }));
    } else {
      setModelStatus(prev => ({ ...prev, [model.id]: 'idle' }));
    }
  };

  const handleDelete = async (model: WhisperModelConfig) => {
    await whisperService.deleteModelById(model.id);
    setModelStatus(prev => ({ ...prev, [model.id]: 'idle' }));
  };

  const handleSelect = async (model: WhisperModelConfig) => {
    if (!isPremium && !(await hasRemainingTrialUses(PREMIUM_FEATURES.VOICE_INPUT))) {
      checkPremiumFeature(PREMIUM_FEATURES.VOICE_INPUT);
      return;
    }

    whisperService.setCurrentModel(model.id);

    if (!whisperService.isReady()) {
      const initialized = await whisperService.initialize();
      if (!initialized) return;
    }

    onClose();
    onModelReady();
  };

  const anyDownloading = Object.values(modelStatus).includes('downloading');

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={() => {
        if (!anyDownloading) onClose();
      }}
      statusBarTranslucent
      navigationBarTranslucent
    >
      <View
        style={[
          styles.overlay,
          {
            paddingTop: insets.top + verticalPadding,
            paddingBottom: bottomSafePadding + verticalPadding,
            paddingHorizontal: horizontalPadding,
          },
        ]}
      >
        <View style={[styles.modal, { width: modalWidth, maxHeight: modalMaxHeight }]}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <View style={styles.iconCircle}>
                <Mic size={18} color={colors.primary} strokeWidth={2} />
              </View>
              <View>
                <Text style={styles.title}>Voice Model</Text>
                <Text style={styles.subtitle}>Offline speech-to-text</Text>
              </View>
            </View>
            <TouchableOpacity
              style={styles.closeButton}
              onPress={onClose}
              disabled={anyDownloading}
              activeOpacity={0.7}
            >
              <X size={18} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* Model list */}
          <ScrollView
            style={styles.listScroll}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
            overScrollMode="never"
          >
            {WHISPER_MODELS.map((model) => {
              const status = modelStatus[model.id] || 'idle';
              const isDownloading = status === 'downloading';
              const isDownloaded = status === 'downloaded';
              const progress = downloadProgress[model.id] || 0;

              return (
                <TouchableOpacity
                  key={model.id}
                  style={[styles.modelRow, isDownloaded && styles.modelRowReady]}
                  onPress={() => {
                    if (isDownloaded) {
                      handleSelect(model);
                    } else if (!isDownloading) {
                      handleDownload(model);
                    }
                  }}
                  disabled={isDownloading}
                  activeOpacity={0.7}
                >
                  <View style={styles.modelInfo}>
                    <View style={styles.modelNameRow}>
                      <Text style={[styles.modelName, !isPremium && styles.modelNameLocked]}>{model.name}</Text>
                      <Text style={styles.modelSize}>{model.size}</Text>
                      {model.recommended && (
                        <View style={styles.recommendedBadge}>
                          <Text style={styles.recommendedBadgeText}>Recommended</Text>
                        </View>
                      )}
                      {model.supportsMultilingual ? (
                        <View style={styles.languageBadge}>
                          <Text style={styles.languageBadgeText}>Multilingual</Text>
                        </View>
                      ) : (
                        <View style={styles.englishOnlyBadge}>
                          <Text style={styles.englishOnlyBadgeText}>English only</Text>
                        </View>
                      )}
                      {!isPremium && (
                        <View style={styles.premiumBadge}>
                          <Lock size={10} color={colors.secondary} />
                          <Text style={styles.premiumBadgeText}>Premium</Text>
                        </View>
                      )}
                    </View>
                    <Text style={[styles.modelDesc, !isPremium && styles.modelDescLocked]}>{model.description}</Text>

                    {isDownloading && (
                      <View style={styles.progressBar}>
                        <View style={[styles.progressFill, { width: `${Math.min(progress, 100)}%` }]} />
                      </View>
                    )}
                  </View>

                  <View style={styles.modelAction}>
                    {isDownloading ? (
                      <View style={styles.progressCircle}>
                        <ActivityIndicator size="small" color={colors.primary} />
                      </View>
                    ) : isDownloaded ? (
                      <View style={styles.actionRow}>
                        <TouchableOpacity
                          style={styles.deleteBtn}
                          onPress={(e) => {
                            e.stopPropagation();
                            handleDelete(model);
                          }}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                          <Trash2 size={14} color={colors.textTertiary} />
                        </TouchableOpacity>
                        <View style={styles.readyBadge}>
                          <Check size={14} color={colors.primary} strokeWidth={2.5} />
                        </View>
                      </View>
                    ) : !isPremium ? (
                      <View style={styles.lockedBadge}>
                        <Lock size={14} color={colors.secondary} />
                      </View>
                    ) : (
                      <View style={styles.downloadBadge}>
                        <Download size={14} color={colors.textSecondary} />
                      </View>
                    )}
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* Footer hint */}
          <Text style={styles.hint}>
            Use a multilingual model for non-English voice input. Smaller models are faster but less accurate.
          </Text>
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles(({ colors, shadows }) => ({
  overlay: {
    flex: 1,
    backgroundColor: colors.scrim,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modal: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    overflow: 'hidden',
    ...shadows.elevated,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.full,
    backgroundColor: colors.primaryMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  subtitle: {
    fontSize: 12,
    color: colors.textTertiary,
    marginTop: 1,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: borderRadius.full,
    backgroundColor: colors.glass,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listScroll: {
    flexShrink: 1,
  },
  list: {
    paddingHorizontal: spacing.md,
    gap: 6,
    paddingBottom: spacing.xs,
  },
  modelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  modelRowReady: {
    borderColor: colors.primaryMuted,
  },
  modelInfo: {
    flex: 1,
    marginRight: spacing.md,
  },
  modelNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  modelName: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  modelNameLocked: {
    color: colors.textTertiary,
  },
  modelSize: {
    fontSize: 11,
    color: colors.textTertiary,
    fontWeight: '500',
  },
  modelDesc: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  modelDescLocked: {
    color: colors.textMuted,
  },
  premiumBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.secondaryMuted,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    borderColor: colors.secondaryGlow,
    marginLeft: spacing.xs,
  },
  premiumBadgeText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: colors.secondary,
  },
  recommendedBadge: {
    backgroundColor: colors.successMuted,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
  },
  recommendedBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.success,
  },
  languageBadge: {
    backgroundColor: colors.primaryMuted,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
  },
  languageBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.primary,
  },
  englishOnlyBadge: {
    backgroundColor: colors.errorMuted,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
  },
  englishOnlyBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.error,
  },
  lockedBadge: {
    width: 28,
    height: 28,
    borderRadius: borderRadius.full,
    backgroundColor: colors.secondaryMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressBar: {
    height: 3,
    backgroundColor: colors.glassMedium,
    borderRadius: 2,
    marginTop: spacing.sm,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: 2,
  },
  modelAction: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  progressCircle: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  readyBadge: {
    width: 28,
    height: 28,
    borderRadius: borderRadius.full,
    backgroundColor: colors.primaryMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  downloadBadge: {
    width: 28,
    height: 28,
    borderRadius: borderRadius.full,
    backgroundColor: colors.glassMedium,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteBtn: {
    width: 28,
    height: 28,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hint: {
    fontSize: 11,
    color: colors.textTertiary,
    textAlign: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
    lineHeight: 16,
  },
}));
