import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check, Download } from 'lucide-react-native';
import { ModelConfig } from '@/constants/models';
import { spacing, borderRadius } from '@/constants/theme';
import { makeStyles, useTheme } from '@/hooks/useTheme';
import { QuoLogo } from '@/components/brand/QuoLogo';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const isTablet = SCREEN_WIDTH >= 768;

interface StarterSetupPanelProps {
  starterModel: ModelConfig;
  isDownloading: boolean;
  isLoading: boolean;
  downloadProgress: number;
  error?: string | null;
  onPress: () => void;
}

// First-run "download one starter model" panel shown to free users with no models
export function StarterSetupPanel({
  starterModel,
  isDownloading,
  isLoading,
  downloadProgress,
  error,
  onPress,
}: StarterSetupPanelProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const isProcessing = isDownloading || isLoading;
  const starterProgress = Math.min(Math.round(downloadProgress), 100);
  const starterButtonLabel = error && !isProcessing ? 'Try Again' : 'Download Starter Model';

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScrollView
        style={styles.starterScroll}
        contentContainerStyle={styles.starterContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.starterLogo}>
          <QuoLogo size={86} />
        </View>

        <Text style={styles.starterTitle}>Private AI on your phone</Text>
        <Text style={styles.starterSubtitle}>
          Download one starter model. After setup, you can ask anything offline.
        </Text>

        <View style={styles.starterCard}>
          <View style={styles.starterModelHeader}>
            <View style={styles.starterIconWrap}>
              <Download size={24} color={colors.primary} />
            </View>
            <View style={styles.starterModelText}>
              <Text style={styles.starterModelName}>{starterModel.name}</Text>
              <Text style={styles.starterModelMeta}>{starterModel.size} one-time download</Text>
            </View>
          </View>

          <Text style={styles.starterModelDescription}>
            Fast enough for most phones and small enough to finish setup quickly.
          </Text>

          <View style={styles.starterFeatureList}>
            <View style={styles.starterFeature}>
              <Check size={14} color={colors.success} />
              <Text style={styles.starterFeatureText}>Runs locally after download</Text>
            </View>
            <View style={styles.starterFeature}>
              <Check size={14} color={colors.success} />
              <Text style={styles.starterFeatureText}>No account or cloud chat required</Text>
            </View>
            <View style={styles.starterFeature}>
              <Check size={14} color={colors.success} />
              <Text style={styles.starterFeatureText}>Change models later in Settings</Text>
            </View>
          </View>

          {isProcessing && (
            <View style={styles.starterProgressContainer}>
              <View style={styles.starterProgressHeader}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={styles.starterProgressText}>
                  {isDownloading ? 'Downloading' : 'Preparing'} {starterProgress}%
                </Text>
              </View>
              <View style={styles.starterProgressTrack}>
                <View style={[styles.starterProgressBar, { width: `${starterProgress}%` }]} />
              </View>
            </View>
          )}

          {!!error && !isProcessing && (
            <View style={styles.starterErrorBox}>
              <Text style={styles.starterErrorText}>{error}</Text>
            </View>
          )}

          <TouchableOpacity
            style={[styles.starterButton, isProcessing && styles.starterButtonDisabled]}
            onPress={onPress}
            disabled={isProcessing}
            activeOpacity={0.85}
          >
            {isProcessing ? (
              <ActivityIndicator size="small" color={colors.onPrimary} />
            ) : (
              <Download size={18} color={colors.onPrimary} />
            )}
            <Text style={styles.starterButtonText}>
              {isProcessing ? 'Setting Up...' : starterButtonLabel}
            </Text>
          </TouchableOpacity>

          <Text style={styles.starterHint}>Use Wi-Fi if available.</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  starterScroll: {
    flex: 1,
  },
  starterContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxl,
  },
  starterLogo: {
    alignSelf: 'center',
    marginBottom: spacing.lg,
  },
  starterTitle: {
    fontSize: isTablet ? 30 : 26,
    fontWeight: '700',
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  starterSubtitle: {
    fontSize: 15,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: spacing.xl,
  },
  starterCard: {
    backgroundColor: colors.glassMedium,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    padding: spacing.lg,
    width: '100%',
    maxWidth: 460,
    alignSelf: 'center',
  },
  starterModelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  starterIconWrap: {
    width: 48,
    height: 48,
    borderRadius: borderRadius.lg,
    backgroundColor: colors.primaryMuted,
    borderWidth: 1,
    borderColor: colors.primaryGlow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  starterModelText: {
    flex: 1,
  },
  starterModelName: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: 2,
  },
  starterModelMeta: {
    fontSize: 13,
    color: colors.textTertiary,
  },
  starterModelDescription: {
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 20,
    marginBottom: spacing.lg,
  },
  starterFeatureList: {
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  starterFeature: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  starterFeatureText: {
    flex: 1,
    fontSize: 13,
    color: colors.textSecondary,
  },
  starterProgressContainer: {
    marginBottom: spacing.lg,
  },
  starterProgressHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  starterProgressText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.primary,
  },
  starterProgressTrack: {
    height: 7,
    backgroundColor: colors.glassStrong,
    borderRadius: borderRadius.full,
    overflow: 'hidden',
  },
  starterProgressBar: {
    height: '100%',
    backgroundColor: colors.primary,
  },
  starterErrorBox: {
    backgroundColor: colors.errorMuted,
    borderWidth: 1,
    borderColor: colors.errorBorder,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  starterErrorText: {
    fontSize: 13,
    color: colors.error,
    lineHeight: 18,
  },
  starterButton: {
    minHeight: 52,
    borderRadius: borderRadius.lg,
    backgroundColor: colors.primaryFill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  starterButtonDisabled: {
    opacity: 0.8,
  },
  starterButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.onPrimary,
  },
  starterHint: {
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.md,
  },
}));
