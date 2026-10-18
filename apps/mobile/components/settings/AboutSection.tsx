import React from 'react';
import { View, Text, TouchableOpacity, Linking, Platform } from 'react-native';
import { Shield, ChevronRight, Star, FileText, Lock } from 'lucide-react-native';
import { spacing, borderRadius, typography } from '@/constants/theme';
import { makeStyles, useTheme } from '@/hooks/useTheme';
import { settingsStyles } from './styles';
import { PRIVACY_POLICY_URL, TERMS_URL, CONTACT_EMAIL } from '@/constants/legal';

// TODO: Set the real numeric App Store ID after the app is created in
// App Store Connect (App Information > Apple ID). Until then the iOS review
// row is hidden instead of opening a dead link.
const APP_STORE_ID_PLACEHOLDER = '0000000000';
const APP_STORE_ID: string = APP_STORE_ID_PLACEHOLDER;

const REVIEW_URL: string | null = Platform.OS === 'ios'
  ? (APP_STORE_ID !== APP_STORE_ID_PLACEHOLDER
    ? `https://apps.apple.com/app/id${APP_STORE_ID}?action=write-review`
    : null)
  : 'https://play.google.com/store/apps/details?id=com.quo.app';

// Shared with the paywall links; URLs live in constants/legal.ts and the
// rows hide themselves while a URL is unset.
const PRIVACY_URL = PRIVACY_POLICY_URL;

async function openLink(url: string) {
  try {
    await Linking.openURL(url);
  } catch (error) {
    console.error('Error opening link:', error);
  }
}

export function AboutSection() {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>About</Text>

      <View style={styles.infoCard}>
        <View style={styles.infoCardHeader}>
          <View style={[styles.infoIconContainer, { backgroundColor: colors.successMuted }]}>
            <Shield size={24} color={colors.success} />
          </View>
          <View style={styles.infoCardTitleContainer}>
            <Text style={styles.infoCardTitle}>Private & Secure</Text>
            <View style={styles.privacyBadge}>
              <Text style={styles.privacyBadgeText}>On-device</Text>
            </View>
          </View>
        </View>
        <Text style={styles.infoCardDescription}>
          All processing happens entirely on your device. Your conversations, memories, and files never leave your phone.
        </Text>
      </View>

      {REVIEW_URL ? (
        <TouchableOpacity
          style={styles.reviewCard}
          onPress={() => openLink(REVIEW_URL)}
          activeOpacity={0.8}
        >
          <View style={styles.reviewCardContent}>
            <View style={styles.reviewIconContainer}>
              <Star size={20} color={colors.warning} fill={colors.warning} />
            </View>
            <View style={styles.reviewTextContainer}>
              <Text style={styles.reviewLabel}>Share Your Feedback</Text>
              <Text style={styles.reviewSubtext}>Help us improve with your honest review</Text>
            </View>
          </View>
          <ChevronRight size={20} color={colors.textTertiary} />
        </TouchableOpacity>
      ) : null}

      {/* Legal links */}
      {PRIVACY_URL ? (
        <TouchableOpacity
          style={styles.legalRow}
          onPress={() => openLink(PRIVACY_URL)}
          activeOpacity={0.7}
        >
          <View style={styles.legalRowContent}>
            <Lock size={18} color={colors.textSecondary} />
            <Text style={styles.legalRowLabel}>Privacy Policy</Text>
          </View>
          <ChevronRight size={18} color={colors.textTertiary} />
        </TouchableOpacity>
      ) : null}

      {TERMS_URL ? (
        <TouchableOpacity
          style={styles.legalRow}
          onPress={() => openLink(TERMS_URL)}
          activeOpacity={0.7}
        >
          <View style={styles.legalRowContent}>
            <FileText size={18} color={colors.textSecondary} />
            <Text style={styles.legalRowLabel}>Terms of Use</Text>
          </View>
          <ChevronRight size={18} color={colors.textTertiary} />
        </TouchableOpacity>
      ) : null}

      {/* Contact & Legal */}
      <View style={styles.legalSection}>
        <Text style={styles.legalText}>
          Developed by Astra Labs
        </Text>
        <Text style={styles.legalText}>
          {CONTACT_EMAIL}
        </Text>
        <Text style={styles.legalTextMuted}>
          © 2026 Astra Labs. All rights reserved.
        </Text>
      </View>
    </View>
  );
}

const useStyles = makeStyles((theme) => {
  const { colors } = theme;
  return {
    ...settingsStyles(theme),
    // Info card styles (Privacy First)
    infoCard: {
      backgroundColor: colors.glassMedium,
      borderRadius: borderRadius.xl,
      borderWidth: 1,
      borderColor: colors.glassBorder,
      padding: spacing.lg,
      marginBottom: spacing.sm,
    },
    infoCardHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: spacing.md,
      gap: spacing.md,
    },
    infoIconContainer: {
      width: 48,
      height: 48,
      borderRadius: borderRadius.lg,
      alignItems: 'center',
      justifyContent: 'center',
    },
    infoCardTitleContainer: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    infoCardTitle: {
      fontSize: typography.sizes.lg,
      fontWeight: typography.weights.bold,
      color: colors.textPrimary,
    },
    privacyBadge: {
      backgroundColor: colors.successMuted,
      paddingHorizontal: spacing.sm,
      paddingVertical: 4,
      borderRadius: borderRadius.full,
    },
    privacyBadgeText: {
      fontSize: 11,
      fontWeight: typography.weights.semibold,
      color: colors.success,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    infoCardDescription: {
      fontSize: typography.sizes.sm,
      color: colors.textSecondary,
      lineHeight: 20,
    },
    // Review card
    reviewCard: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      backgroundColor: colors.glassMedium,
      borderRadius: borderRadius.xl,
      borderWidth: 1,
      borderColor: colors.glassBorder,
      padding: spacing.md,
      paddingHorizontal: spacing.lg,
      marginTop: spacing.sm,
    },
    reviewCardContent: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      flex: 1,
    },
    reviewIconContainer: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.warningMuted,
      alignItems: 'center',
      justifyContent: 'center',
    },
    reviewTextContainer: {
      flex: 1,
    },
    reviewLabel: {
      fontSize: typography.sizes.md,
      fontWeight: typography.weights.semibold,
      color: colors.textPrimary,
      marginBottom: 2,
    },
    reviewSubtext: {
      fontSize: typography.sizes.sm,
      color: colors.textSecondary,
    },
    // Legal link rows
    legalRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      backgroundColor: colors.glassMedium,
      borderRadius: borderRadius.xl,
      borderWidth: 1,
      borderColor: colors.glassBorder,
      padding: spacing.md,
      paddingHorizontal: spacing.lg,
      marginTop: spacing.sm,
    },
    legalRowContent: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      flex: 1,
    },
    legalRowLabel: {
      fontSize: typography.sizes.md,
      fontWeight: typography.weights.medium,
      color: colors.textPrimary,
    },
    // Legal section styles
    legalSection: {
      marginTop: spacing.xl,
      alignItems: 'center',
      paddingVertical: spacing.lg,
    },
    legalText: {
      fontSize: typography.sizes.sm,
      color: colors.textSecondary,
      marginBottom: spacing.xs,
    },
    legalTextMuted: {
      fontSize: typography.sizes.xs,
      color: colors.textMuted,
      marginTop: spacing.sm,
    },
  };
});
