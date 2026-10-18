import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { spacing } from '@/constants/theme';
import { makeStyles } from '@/hooks/useTheme';
import { getPhaseDisplayProgress } from '@/utils/modelProgress';

export function ModelStatusBadge({
  modelLoaded,
  modelStatus,
  progress,
  onPress,
}: {
  modelLoaded: boolean;
  modelStatus: string;
  progress: number;
  onPress?: () => void;
}) {
  const statusStyles = useStyles();
  if (modelLoaded) {
    return (
      <View style={statusStyles.badge}>
        <View style={statusStyles.dot} />
        <Text style={statusStyles.text}>Ready</Text>
      </View>
    );
  }

  if (modelStatus === 'downloading') {
    const downloadPercent = Math.min(Math.round(getPhaseDisplayProgress(modelStatus, progress)), 99);
    return (
      <View style={statusStyles.badge}>
        <View style={[statusStyles.dot, statusStyles.dotActive]} />
        <Text style={statusStyles.textActive}>Downloading {downloadPercent}%</Text>
      </View>
    );
  }

  if (modelStatus === 'loading') {
    const loadPercent = Math.min(Math.round(getPhaseDisplayProgress(modelStatus, progress)), 99);
    return (
      <View style={statusStyles.badge}>
        <View style={[statusStyles.dot, statusStyles.dotActive]} />
        <Text style={statusStyles.textActive}>Loading {loadPercent}%</Text>
      </View>
    );
  }

  return (
    <TouchableOpacity style={statusStyles.badge} onPress={onPress} activeOpacity={0.7}>
      <View style={[statusStyles.dot, statusStyles.dotInactive]} />
      <Text style={statusStyles.textInactive}>Tap to load</Text>
    </TouchableOpacity>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.success,
  },
  dotActive: {
    backgroundColor: colors.primary,
  },
  dotInactive: {
    backgroundColor: colors.textMuted,
  },
  text: {
    fontSize: 14,
    color: colors.success,
    fontWeight: '500',
  },
  textActive: {
    fontSize: 14,
    color: colors.primary,
    fontWeight: '500',
  },
  textInactive: {
    fontSize: 14,
    color: colors.textTertiary,
    fontWeight: '400',
  },
}));
