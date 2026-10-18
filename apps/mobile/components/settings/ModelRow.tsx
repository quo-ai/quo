import React, { ReactNode } from 'react';
import { ModelExpectationHint } from '@/components/ModelExpectationHint';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Trash2, Download, Check, Eye, Brain, ChevronRight, Link, Lock } from 'lucide-react-native';
import { getModelMemoryVerdict } from '@/utils/deviceCapability';
import { spacing, borderRadius, typography } from '@/constants/theme';
import { makeStyles, useTheme } from '@/hooks/useTheme';
import { ModelDownloadStatus } from './useModelDownloadStatus';
import { settingsStyles } from './styles';

interface ModelRowProps {
  model: {
    id: string;
    name: string;
    description: string;
    size: string;
    sizeBytes: number;
    hasVision: boolean;
    features?: string[];
  };
  status: ModelDownloadStatus | undefined;
  progress: number;
  isSelected: boolean;
  isLocked: boolean;
  isCustom?: boolean;
  /** The active model is loaded (shows the Active badge on the selected row). */
  modelLoaded: boolean;
  /** Any model switch is in progress (disables rows, hides Active). */
  isSwitching: boolean;
  /** This row is the model being switched to. */
  isSwitchingToThis: boolean;
  canDelete: boolean;
  /** Extra header badges (Recommended, Free, …). */
  badges?: ReactNode;
  /** Extra content under the meta line (e.g. the thinking toggle). */
  children?: ReactNode;
  onPress: () => void;
  onDelete: () => void;
}

/** One model in the Settings model list — shared by built-in and custom models. */
export function ModelRow({
  model,
  status,
  progress,
  isSelected,
  isLocked,
  isCustom = false,
  modelLoaded,
  isSwitching,
  isSwitchingToThis,
  canDelete,
  badges,
  children,
  onPress,
  onDelete,
}: ModelRowProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const isDownloading = status === 'downloading';
  const isDownloaded = status === 'downloaded';
  const memoryVerdict = getModelMemoryVerdict(model.sizeBytes);
  const features = model.features ?? [];

  return (
    <TouchableOpacity
      style={[styles.modelRow, isSelected && styles.modelRowSelected, isLocked && styles.modelRowLocked]}
      onPress={onPress}
      disabled={isDownloading || isSwitching}
    >
      <View style={styles.modelInfo}>
        <View style={styles.modelHeader}>
          <Text style={[styles.modelName, isLocked && styles.modelNameLocked]}>{model.name}</Text>
          {isLocked && (
            <View style={styles.premiumBadge}>
              <Lock size={10} color={colors.secondary} />
              <Text style={styles.premiumBadgeText}>Premium</Text>
            </View>
          )}
          {badges}
          {isSelected && isDownloaded && modelLoaded && !isSwitching && (
            <View style={styles.activeBadge}>
              <Text style={styles.activeBadgeText}>Active</Text>
            </View>
          )}
          {isSwitchingToThis && (
            <View style={styles.loadingBadge}>
              <Text style={styles.loadingBadgeText}>Loading...</Text>
            </View>
          )}
        </View>
        <Text style={[styles.modelDescription, isLocked && styles.modelDescriptionLocked]}>{model.description}</Text>
        <ModelExpectationHint sizeBytes={model.sizeBytes} />
        <View style={styles.modelMeta}>
          <Text style={styles.modelSize}>{model.size || 'Unknown size'}</Text>
          {model.hasVision && (
            <View style={styles.featureBadge}>
              <Eye size={12} color={colors.secondary} />
              <Text style={styles.featureText}>Vision</Text>
            </View>
          )}
          {features.includes('reasoning') && (
            <View style={styles.featureBadge}>
              <Brain size={12} color={colors.warning} />
              <Text style={styles.featureText}>Reasoning</Text>
            </View>
          )}
          {isCustom && (
            <View style={styles.customBadge}>
              <Link size={12} color={colors.primary} />
              <Text style={styles.customBadgeText}>Custom</Text>
            </View>
          )}
        </View>
        {memoryVerdict !== 'ok' && (
          <Text style={memoryVerdict === 'unsupported' ? styles.memoryWarningError : styles.memoryWarning}>
            {memoryVerdict === 'unsupported'
              ? "Exceeds this device's memory — may crash"
              : 'May be unstable on this device'}
          </Text>
        )}
        {children}
        {isDownloading && (
          <View style={styles.progressContainer}>
            <View style={[styles.progressBar, { width: `${progress}%` }]} />
            <Text style={styles.progressText}>{Math.round(progress)}%</Text>
          </View>
        )}
      </View>
      <View style={styles.modelActions}>
        {canDelete && !isDownloading && (
          <TouchableOpacity
            style={styles.deleteModelButton}
            onPress={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Trash2 size={16} color={colors.textTertiary} />
          </TouchableOpacity>
        )}
        <View style={styles.modelAction}>
          {isLocked ? (
            <Lock size={18} color={colors.secondary} />
          ) : isDownloading ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : isDownloaded ? (
            isSelected ? (
              <Check size={20} color={colors.success} />
            ) : (
              <ChevronRight size={20} color={colors.textTertiary} />
            )
          ) : (
            <Download size={20} color={colors.primary} />
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

const useStyles = makeStyles((theme) => {
  const { colors } = theme;
  return {
    ...settingsStyles(theme),
    loadingBadge: {
      backgroundColor: colors.primaryMuted,
      paddingHorizontal: spacing.sm,
      paddingVertical: 2,
      borderRadius: borderRadius.sm,
    },
    loadingBadgeText: {
      fontSize: typography.sizes.xs,
      fontWeight: typography.weights.semibold,
      color: colors.primary,
    },
    customBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      backgroundColor: colors.primaryMuted,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: borderRadius.sm,
    },
    customBadgeText: {
      fontSize: typography.sizes.xs,
      color: colors.primary,
    },
    memoryWarning: {
      marginTop: spacing.xs,
      fontSize: typography.sizes.xs,
      color: colors.warning,
    },
    memoryWarningError: {
      marginTop: spacing.xs,
      fontSize: typography.sizes.xs,
      color: colors.error,
    },
  };
});
