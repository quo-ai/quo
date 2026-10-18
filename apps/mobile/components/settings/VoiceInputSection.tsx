import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Trash2, Download, Check, Mic, Lock } from 'lucide-react-native';
import { PREMIUM_FEATURES } from '@/contexts/PremiumContext';
import { whisperService, WHISPER_MODELS, WhisperModelConfig } from '@/services/whisperService';
import { hasRemainingTrialUses } from '@/services/trialService';
import { useTheme } from '@/hooks/useTheme';
import { useSettingsStyles } from './styles';

interface VoiceInputSectionProps {
  isPremium: boolean;
  checkPremiumFeature: (featureName: string) => boolean;
}

export function VoiceInputSection({ isPremium, checkPremiumFeature }: VoiceInputSectionProps) {
  const { colors } = useTheme();
  const styles = useSettingsStyles();
  const [whisperModelStatus, setWhisperModelStatus] = useState<Record<string, 'not_downloaded' | 'downloading' | 'downloaded'>>({});
  const [whisperDownloadProgress, setWhisperDownloadProgress] = useState<Record<string, number>>({});
  // Free users can use voice while they have trial uses left (same gate as
  // VoiceModelModal), so only lock the models once the trial is exhausted.
  const [hasVoiceTrial, setHasVoiceTrial] = useState(false);

  useEffect(() => {
    checkWhisperStatus();
  }, []);

  // Re-check model status when screen comes into focus
  useFocusEffect(
    useCallback(() => {
      checkWhisperStatus();
    }, [])
  );

  const checkWhisperStatus = async () => {
    setHasVoiceTrial(await hasRemainingTrialUses(PREMIUM_FEATURES.VOICE_INPUT));
    const status: Record<string, 'not_downloaded' | 'downloaded'> = {};
    for (const model of WHISPER_MODELS) {
      const downloaded = await whisperService.isModelDownloaded(model.id);
      status[model.id] = downloaded ? 'downloaded' : 'not_downloaded';
    }
    setWhisperModelStatus(status);
  };

  const handleDownloadWhisperModel = async (model: WhisperModelConfig) => {
    if (whisperModelStatus[model.id] === 'downloading') return;

    Alert.alert(
      `Download ${model.name}?`,
      `This will download the voice model (${model.size}) for offline speech-to-text.\n\n${model.description}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Download',
          onPress: async () => {
            setWhisperModelStatus(prev => ({ ...prev, [model.id]: 'downloading' }));
            setWhisperDownloadProgress(prev => ({ ...prev, [model.id]: 0 }));

            whisperService.setCurrentModel(model.id);
            const success = await whisperService.downloadModel(model.id, (progress) => {
              setWhisperDownloadProgress(prev => ({ ...prev, [model.id]: progress }));
            });

            if (success) {
              setWhisperModelStatus(prev => ({ ...prev, [model.id]: 'downloaded' }));
              Alert.alert('Download Complete', `${model.name} is ready for offline use.`);
            } else {
              setWhisperModelStatus(prev => ({ ...prev, [model.id]: 'not_downloaded' }));
              Alert.alert('Download Failed', 'Please check your internet connection and try again.');
            }
          },
        },
      ]
    );
  };

  const handleDeleteWhisperModel = async (model: WhisperModelConfig) => {
    Alert.alert(
      `Delete ${model.name}?`,
      `This will remove the voice model (${model.size}) from your device. You can re-download it later.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await whisperService.deleteModelById(model.id);
            setWhisperModelStatus(prev => ({ ...prev, [model.id]: 'not_downloaded' }));
            Alert.alert('Model Deleted', `${model.name} has been removed from your device.`);
          },
        },
      ]
    );
  };

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Voice Input</Text>
      <Text style={styles.sectionDescription}>
        Offline speech-to-text powered by Whisper AI.
      </Text>

      <View style={styles.card}>
        {WHISPER_MODELS.map((model) => {
          const status = whisperModelStatus[model.id];
          const isDownloading = status === 'downloading';
          const isDownloaded = status === 'downloaded';
          const progress = whisperDownloadProgress[model.id] || 0;
          // Voice input is premium — free users are locked out once their
          // trial uses are gone (downloaded models can still be deleted).
          const isVoiceLocked = !isPremium && !hasVoiceTrial;

          return (
            <TouchableOpacity
              key={model.id}
              style={[styles.modelRow, isVoiceLocked && styles.modelRowLocked]}
              onPress={() => {
                if (isVoiceLocked) {
                  checkPremiumFeature(PREMIUM_FEATURES.VOICE_INPUT);
                  return;
                }
                if (!isDownloaded) {
                  handleDownloadWhisperModel(model);
                }
              }}
              disabled={isDownloading}
            >
              <View style={styles.modelInfo}>
                <View style={styles.modelHeader}>
                  <Text style={[styles.modelName, isVoiceLocked && styles.modelNameLocked]}>{model.name}</Text>
                  {isVoiceLocked && (
                    <View style={styles.premiumBadge}>
                      <Lock size={10} color={colors.secondary} />
                      <Text style={styles.premiumBadgeText}>Premium</Text>
                    </View>
                  )}
                  {!isVoiceLocked && isDownloaded && (
                    <View style={styles.activeBadge}>
                      <Text style={styles.activeBadgeText}>Ready</Text>
                    </View>
                  )}
                </View>
                <Text style={[styles.modelDescription, isVoiceLocked && styles.modelDescriptionLocked]}>{model.description}</Text>
                <View style={styles.modelMeta}>
                  <Text style={styles.modelSize}>{model.size}</Text>
                  <View style={styles.featureBadge}>
                    <Mic size={12} color={colors.secondary} />
                    <Text style={styles.featureText}>Offline</Text>
                  </View>
                </View>
                {isDownloading && (
                  <View style={styles.progressContainer}>
                    <View style={[styles.progressBar, { width: `${progress}%` }]} />
                    <Text style={styles.progressText}>{Math.round(progress)}%</Text>
                  </View>
                )}
              </View>
              <View style={styles.modelActions}>
                {isDownloaded && (
                  <TouchableOpacity
                    style={styles.deleteModelButton}
                    onPress={(e) => {
                      e.stopPropagation();
                      handleDeleteWhisperModel(model);
                    }}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <Trash2 size={16} color={colors.textTertiary} />
                  </TouchableOpacity>
                )}
                <View style={styles.modelAction}>
                  {isVoiceLocked ? (
                    <Lock size={18} color={colors.secondary} />
                  ) : isDownloading ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : isDownloaded ? (
                    <Check size={20} color={colors.success} />
                  ) : (
                    <Download size={20} color={colors.primary} />
                  )}
                </View>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

