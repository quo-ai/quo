import React from 'react';
import { Modal, View, Text, TouchableOpacity, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { makeStyles } from '@/hooks/useTheme';
import { PRIVACY_POLICY_URL } from '@/constants/legal';
import { borderRadius, spacing } from '@/constants/theme';

interface AnalyticsConsentPromptProps {
  visible: boolean;
  onAllow: () => void;
  onDecline: () => void;
}

/**
 * Opt-in consent for usage statistics and crash reports (EU/EEA). Built to
 * the GDPR consent standard: says what is collected, by whom and why, links
 * the policy, explains withdrawal, and gives both answers identical weight.
 * Android back counts as "Don't allow"; nothing is collected until "Allow".
 */
export function AnalyticsConsentPrompt({ visible, onAllow, onDecline }: AnalyticsConsentPromptProps) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDecline}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.xl }]}>
          <Text style={styles.title} accessibilityRole="header">Help improve Quo?</Text>
          <Text style={styles.body}>
            Can we collect usage statistics and crash reports? They help us fix bugs and improve
            Quo, and are processed for us by Google Firebase.
          </Text>
          <Text style={styles.body}>
            They never include your chats, files, photos or voice.
          </Text>
          <Text style={styles.note}>
            You can change this anytime in Settings → Data.{' '}
            <Text
              style={styles.link}
              accessibilityRole="link"
              onPress={() => { void Linking.openURL(PRIVACY_POLICY_URL).catch(() => {}); }}
            >
              Privacy Policy
            </Text>
          </Text>

          <View style={styles.actions}>
            <TouchableOpacity style={styles.button} onPress={onDecline} accessibilityRole="button" activeOpacity={0.8}>
              <Text style={styles.buttonText}>Don’t allow</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.button} onPress={onAllow} accessibilityRole="button" activeOpacity={0.8}>
              <Text style={styles.buttonText}>Allow</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles(({ colors, shadows }) => ({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: colors.scrim,
  },
  sheet: {
    backgroundColor: colors.surfaceElevated,
    borderTopLeftRadius: borderRadius.xxl,
    borderTopRightRadius: borderRadius.xxl,
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.xxl,
    ...shadows.elevated,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: spacing.md,
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  note: {
    fontSize: 13,
    lineHeight: 19,
    color: colors.textTertiary,
    marginTop: spacing.xs,
  },
  link: {
    color: colors.primary,
    fontWeight: '600',
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.xl,
  },
  // Both choices share one style: equal prominence is a consent requirement.
  button: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.lg,
    borderRadius: borderRadius.lg,
    backgroundColor: colors.glassStrong,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
  },
}));
