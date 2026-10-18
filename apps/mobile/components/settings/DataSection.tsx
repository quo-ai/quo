import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Trash2, ChevronRight, ChartBar } from 'lucide-react-native';
import { spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/hooks/useTheme';
import { analyticsService } from '@/services/analyticsService';
import { settingsStyles } from './styles';

// The "tap again to confirm" state expires so a stray tap minutes later
// can't wipe every chat.
const CLEAR_CONFIRM_TIMEOUT_MS = 4000;

interface DataSectionProps {
  clearAllChats: () => void;
}

export function DataSection({ clearAllChats }: DataSectionProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [analyticsEnabled, setAnalyticsEnabledState] = useState(false);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let mounted = true;
    void analyticsService.isAnalyticsEnabled().then((enabled) => {
      if (mounted) setAnalyticsEnabledState(enabled);
    });
    const unsubscribe = analyticsService.subscribeAnalyticsEnabled(setAnalyticsEnabledState);
    return () => {
      mounted = false;
      unsubscribe();
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    };
  }, []);

  const handleClearChats = () => {
    if (confirmTimerRef.current) {
      clearTimeout(confirmTimerRef.current);
      confirmTimerRef.current = null;
    }
    if (showClearConfirm) {
      clearAllChats();
      setShowClearConfirm(false);
    } else {
      setShowClearConfirm(true);
      confirmTimerRef.current = setTimeout(() => {
        confirmTimerRef.current = null;
        setShowClearConfirm(false);
      }, CLEAR_CONFIRM_TIMEOUT_MS);
    }
  };

  const handleToggleAnalytics = () => {
    void analyticsService.setAnalyticsEnabled(!analyticsEnabled);
  };

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Data</Text>

      <View style={[styles.card, styles.analyticsCard]}>
        <TouchableOpacity
          style={styles.settingRow}
          onPress={handleToggleAnalytics}
          activeOpacity={0.7}
          accessibilityRole="switch"
          accessibilityState={{ checked: analyticsEnabled }}
        >
          <View style={styles.settingIcon}>
            <ChartBar size={20} color={analyticsEnabled ? colors.primary : colors.textTertiary} />
          </View>
          <View style={styles.settingContent}>
            <Text style={styles.settingLabel}>Share Usage Analytics</Text>
            <Text style={styles.settingDescription}>
              App usage events and crash reports, processed by Google Firebase. Never includes your chats, prompts, or files.
            </Text>
          </View>
          <View style={[styles.miniSwitch, analyticsEnabled && styles.miniSwitchActive]}>
            <View style={[styles.miniSwitchThumb, analyticsEnabled && styles.miniSwitchThumbActive]} />
          </View>
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        style={[styles.featureCard, styles.dangerFeatureCard]}
        onPress={handleClearChats}
        activeOpacity={0.7}
      >
        <View style={[styles.featureIconContainer, { backgroundColor: colors.errorMuted }]}>
          <Trash2 size={22} color={colors.error} />
        </View>
        <View style={styles.featureContent}>
          <Text style={[styles.featureTitle, { color: colors.error }]}>
            {showClearConfirm ? 'Tap again to confirm' : 'Clear All Chats'}
          </Text>
          <Text style={styles.featureSubtitle}>
            Permanently delete all chat history
          </Text>
        </View>
        <ChevronRight size={20} color={colors.textMuted} />
      </TouchableOpacity>
    </View>
  );
}

const useStyles = makeStyles((theme) => {
  const { colors } = theme;
  return {
    ...settingsStyles(theme),
    analyticsCard: {
      marginBottom: spacing.sm,
    },
    dangerFeatureCard: {
      borderColor: colors.errorBorder,
    },
  };
});
