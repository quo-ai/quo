import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Smartphone, Sun, Moon, type LucideIcon } from 'lucide-react-native';
import { spacing, borderRadius, typography } from '@/constants/theme';
import { makeStyles, useTheme, useThemePreference, type ThemePreference } from '@/hooks/useTheme';
import { settingsStyles } from './styles';

const OPTIONS: { value: ThemePreference; label: string; Icon: LucideIcon }[] = [
  { value: 'system', label: 'System', Icon: Smartphone },
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
];

/** Light / dark / follow-the-device switch (Settings → Appearance). */
export function AppearanceSection() {
  const { colors } = useTheme();
  const styles = useStyles();
  const { preference, setPreference } = useThemePreference();

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Appearance</Text>

      <View style={styles.segmentedControl} accessibilityRole="radiogroup">
        {OPTIONS.map(({ value, label, Icon }) => {
          const selected = preference === value;
          return (
            <TouchableOpacity
              key={value}
              style={[styles.segment, selected && styles.segmentSelected]}
              onPress={() => setPreference(value)}
              activeOpacity={0.7}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              accessibilityLabel={`${label} appearance`}
            >
              <Icon size={16} color={selected ? colors.onPrimary : colors.textSecondary} />
              <Text style={[styles.segmentLabel, selected && styles.segmentLabelSelected]}>{label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const useStyles = makeStyles((theme) => {
  const { colors } = theme;
  return {
    ...settingsStyles(theme),
    segmentedControl: {
      flexDirection: 'row',
      backgroundColor: colors.glassMedium,
      borderRadius: borderRadius.xl,
      borderWidth: 1,
      borderColor: colors.glassBorder,
      padding: spacing.xs,
      gap: spacing.xs,
    },
    segment: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      paddingVertical: spacing.md,
      borderRadius: borderRadius.lg,
    },
    segmentSelected: {
      backgroundColor: colors.primaryFill,
    },
    segmentLabel: {
      fontSize: typography.sizes.md,
      fontWeight: typography.weights.medium,
      color: colors.textSecondary,
    },
    segmentLabelSelected: {
      color: colors.onPrimary,
      fontWeight: typography.weights.semibold,
    },
  };
});
