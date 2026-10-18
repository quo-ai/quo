import React from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { AVAILABLE_MODELS } from '@/constants/models';
import { spacing, borderRadius } from '@/constants/theme';
import { makeStyles, useTheme } from '@/hooks/useTheme';

interface DownloadStatusBannerProps {
  downloadingModelId: string;
  isDownloading: boolean;
  isLoading: boolean;
  downloadProgress: number;
}

// Download/loading progress indicator shown above the family list
export function DownloadStatusBanner({
  downloadingModelId,
  isDownloading,
  isLoading,
  downloadProgress,
}: DownloadStatusBannerProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <View style={styles.downloadStatusContainer}>
      <View style={styles.downloadStatusContent}>
        <View style={styles.downloadStatusHeader}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={styles.downloadStatusTitle}>
            {isDownloading ? 'Downloading Model...' : 'Loading Model...'}
          </Text>
        </View>
        <Text style={styles.downloadStatusModel}>
          {AVAILABLE_MODELS.find(m => m.id === downloadingModelId)?.name || downloadingModelId}
        </Text>
        <View style={styles.downloadProgressContainer}>
          <View style={styles.downloadProgressTrack}>
            <View style={[styles.downloadProgressBar, { width: `${Math.min(downloadProgress, 100)}%` }]} />
          </View>
          <Text style={styles.downloadProgressText}>
            {Math.min(Math.round(downloadProgress), 100)}%
          </Text>
        </View>
        {isLoading && (
          <Text style={styles.downloadStatusHint}>
            Preparing model — this only happens once.
          </Text>
        )}
      </View>
    </View>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  downloadStatusContainer: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  downloadStatusContent: {
    backgroundColor: colors.primaryMuted,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.primaryGlow,
    padding: spacing.lg,
  },
  downloadStatusHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  downloadStatusTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.primary,
  },
  downloadStatusModel: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: spacing.md,
  },
  downloadProgressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  downloadProgressTrack: {
    flex: 1,
    height: 6,
    backgroundColor: colors.glassStrong,
    borderRadius: 3,
    overflow: 'hidden',
  },
  downloadProgressBar: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: 3,
  },
  downloadProgressText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.primary,
    minWidth: 45,
    textAlign: 'right',
  },
  downloadStatusHint: {
    fontSize: 12,
    color: colors.textTertiary,
    marginTop: spacing.sm,
    fontStyle: 'italic',
  },
}));
