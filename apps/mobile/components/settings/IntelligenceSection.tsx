import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { Trash2, Search, Zap } from 'lucide-react-native';
import { PREMIUM_FEATURES } from '@/contexts/PremiumContext';
import { AVAILABLE_MODELS } from '@/constants/models';
import { recallService, RECALL_MODEL } from '@/services/recallService';
import { llmService } from '@/services/llm';
import { AppSettings } from '@/types/chat';
import { useTheme } from '@/hooks/useTheme';
import { useSettingsStyles } from './styles';

interface IntelligenceSectionProps {
  settings: AppSettings;
  updateSettings: (settings: Partial<AppSettings>) => void;
  isPremium: boolean;
  checkPremiumFeature: (featureName: string) => boolean;
}

export function IntelligenceSection({ settings, updateSettings, isPremium, checkPremiumFeature }: IntelligenceSectionProps) {
  const { colors } = useTheme();
  const styles = useSettingsStyles();
  const [recallEnabled, setRecallEnabled] = useState(false);
  const [recallDownloading, setRecallDownloading] = useState(false);
  const [recallProgress, setRecallProgress] = useState(0);
  const [recallDownloaded, setRecallDownloaded] = useState(false);

  useEffect(() => {
    recallService.isEnabled().then(setRecallEnabled).catch(() => {});
    recallService.isModelDownloaded().then(setRecallDownloaded).catch(() => {});
  }, []);

  const handleRecallPress = async () => {
    if (!isPremium) {
      checkPremiumFeature(PREMIUM_FEATURES.ENHANCED_RECALL);
      return;
    }
    if (recallEnabled) {
      await recallService.setEnabled(false);
      setRecallEnabled(false);
      return;
    }
    if (!(await recallService.isModelDownloaded())) {
      setRecallDownloading(true);
      setRecallProgress(0);
      const ok = await recallService.downloadModel((progress) => setRecallProgress(progress));
      setRecallDownloading(false);
      if (!ok) {
        Alert.alert('Download Failed', 'Could not download the recall model. Please check your connection and try again.');
        return;
      }
      setRecallDownloaded(true);
    }
    await recallService.setEnabled(true);
    setRecallEnabled(true);
  };

  const handleRecallDelete = () => {
    Alert.alert(
      'Delete Recall Model?',
      `Frees ${RECALL_MODEL.sizeLabel} and turns Enhanced Recall off. You can download it again anytime.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await recallService.deleteModel();
            setRecallEnabled(false);
            setRecallDownloaded(false);
          },
        },
      ],
    );
  };

  const currentModel = AVAILABLE_MODELS.find(m => m.id === settings.modelId);
  const [speedFileDownloading, setSpeedFileDownloading] = useState(false);

  const handleSpeculativeToggle = async () => {
    const enabling = !settings.enableSpeculative;
    // Models with an MTP speed file need it on disk before Speed Boost helps.
    if (enabling && currentModel?.mtpDraft && !(await llmService.hasMtpDraft(currentModel))) {
      setSpeedFileDownloading(true);
      const ok = await llmService.downloadMtpDraft(currentModel);
      setSpeedFileDownloading(false);
      if (!ok) {
        Alert.alert('Download Failed', 'Could not download the speed file. Check your connection and try again.');
        return;
      }
    }
    updateSettings({ enableSpeculative: enabling });
  };

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Intelligence</Text>
      <Text style={styles.sectionDescription}>
        Optional upgrades that make long conversations sharper and faster.
      </Text>

      <View style={styles.card}>
        <TouchableOpacity
          style={styles.settingRow}
          onPress={handleRecallPress}
          disabled={recallDownloading}
          activeOpacity={0.7}
        >
          <View style={styles.settingIcon}>
            <Search size={20} color={recallEnabled ? colors.primary : colors.textTertiary} />
          </View>
          <View style={styles.settingContent}>
            <Text style={styles.settingLabel}>Enhanced Recall{!isPremium ? '  🔒' : ''}</Text>
            <Text style={styles.settingDescription}>
              {recallEnabled
                ? 'Semantic memory is on — the AI retrieves exact details from long chats.'
                : `Retrieve exact details from long conversations (${RECALL_MODEL.sizeLabel} one-time download).`}
            </Text>
            {recallDownloading && (
              <View style={styles.progressContainer}>
                <View style={[styles.progressBar, { width: `${recallProgress}%` }]} />
                <Text style={styles.progressText}>{Math.round(recallProgress)}%</Text>
              </View>
            )}
          </View>
          {recallDownloaded && !recallDownloading && (
            <TouchableOpacity
              style={styles.deleteModelButton}
              onPress={(e) => {
                e.stopPropagation();
                handleRecallDelete();
              }}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Trash2 size={16} color={colors.textTertiary} />
            </TouchableOpacity>
          )}
          {recallDownloading ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <View style={[styles.miniSwitch, recallEnabled && styles.miniSwitchActive]}>
              <View style={[styles.miniSwitchThumb, recallEnabled && styles.miniSwitchThumbActive]} />
            </View>
          )}
        </TouchableOpacity>
      </View>

      {Boolean(currentModel?.draftModelId || currentModel?.mtpDraft) && (
        <View style={styles.card}>
          <TouchableOpacity style={styles.settingRow} onPress={handleSpeculativeToggle} activeOpacity={0.7}>
            <View style={styles.settingIcon}>
              <Zap size={20} color={settings.enableSpeculative ? colors.primary : colors.textTertiary} />
            </View>
            <View style={styles.settingContent}>
              <Text style={styles.settingLabel}>Speed Boost (experimental)</Text>
              <Text style={styles.settingDescription}>
                {currentModel?.mtpDraft
                  ? `Uses this model's speed file (${Math.round(currentModel.mtpDraft.sizeBytes / 1e6)} MB, one-time download) to reply faster. Applies on next model load.`
                  : 'Drafts replies with the small starter model to speed up this model. Needs the starter model downloaded. Applies on next model load.'}
              </Text>
            </View>
            {speedFileDownloading ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <View style={[styles.miniSwitch, settings.enableSpeculative && styles.miniSwitchActive]}>
                <View style={[styles.miniSwitchThumb, settings.enableSpeculative && styles.miniSwitchThumbActive]} />
              </View>
            )}
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

