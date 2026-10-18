import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { BarChart3 } from 'lucide-react-native';
import { AppSettings } from '@/types/chat';
import { makeStyles, useTheme } from '@/hooks/useTheme';
import { settingsStyles } from './styles';

interface AdvancedSectionProps {
  settings: AppSettings;
  updateSettings: (settings: Partial<AppSettings>) => void;
}

export function AdvancedSection({ settings, updateSettings }: AdvancedSectionProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Advanced</Text>

      <TouchableOpacity
        style={styles.featureCard}
        onPress={() => updateSettings({ showGenerationStats: !settings.showGenerationStats })}
        activeOpacity={0.7}
      >
        <View style={[styles.featureIconContainer, { backgroundColor: colors.primaryMuted }]}>
          <BarChart3 size={22} color={colors.primary} />
        </View>
        <View style={styles.featureContent}>
          <Text style={styles.featureTitle}>Generation Stats</Text>
          <Text style={styles.featureSubtitle}>
            Show tokens, speed & context on messages
          </Text>
        </View>
        <View style={[styles.switchTrack, settings.showGenerationStats && styles.switchTrackActive]}>
          <View style={[styles.switchThumb, settings.showGenerationStats && styles.switchThumbActive]} />
        </View>
      </TouchableOpacity>
    </View>
  );
}

const useStyles = makeStyles((theme) => {
  const { colors } = theme;
  return {
    ...settingsStyles(theme),
    // iOS-style switch
    switchTrack: {
      width: 51,
      height: 31,
      borderRadius: 16,
      backgroundColor: colors.glassStrong,
      padding: 2,
      justifyContent: 'center',
    },
    switchTrackActive: {
      backgroundColor: colors.primaryFill,
    },
    switchThumb: {
      width: 27,
      height: 27,
      borderRadius: 14,
      backgroundColor: colors.onPrimary,
      ...theme.shadows.soft,
      shadowOffset: { width: 0, height: 2 },
      shadowRadius: 2,
      elevation: 2,
    },
    switchThumbActive: {
      transform: [{ translateX: 20 }],
    },
  };
});
