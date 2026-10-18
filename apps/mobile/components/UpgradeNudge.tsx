import React from 'react';
import { Modal, View, Text, TouchableOpacity, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check } from 'lucide-react-native';
import { QuoLogo } from '@/components/brand/QuoLogo';
import { PremiumGradient } from '@/components/premium/PremiumGradient';
import { usePremium } from '@/contexts/PremiumContext';
import { makeStyles, useTheme } from '@/hooks/useTheme';
import { borderRadius, spacing } from '@/constants/theme';

const BENEFITS = [
  'Every model, including Qwen 4B and Gemma 4',
  'Voice input, read aloud and image analysis',
  'Unlimited chats and memory',
];

interface UpgradeNudgeProps {
  visible: boolean;
  answers: number;
  onUnlock: () => void;
  onDismiss: () => void;
}

/**
 * One-time upgrade nudge for engaged free users (hooks/useUpgradeNudge).
 * Leads with what they've already done with Quo, then three concrete
 * benefits, and a single CTA that goes straight to the store purchase.
 */
export function UpgradeNudge({ visible, answers, onUnlock, onDismiss }: UpgradeNudgeProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  const { productPrice, isProcessingPurchase } = usePremium();
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onDismiss}>
      <Pressable style={styles.backdrop} onPress={onDismiss} accessibilityLabel="Close" />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.xl }]}>
        <View style={styles.handle} />
        <View style={styles.logo}>
          <QuoLogo size={56} backgroundColor={colors.surfaceElevated} />
        </View>
        <Text style={styles.title}>{`You've asked Quo ${answers} questions`}</Text>
        <Text style={styles.subtitle}>Unlock everything Quo can do, privately on your phone.</Text>

        <View style={styles.benefits}>
          {BENEFITS.map(benefit => (
            <View key={benefit} style={styles.benefitRow}>
              <View style={styles.check}>
                <Check size={14} color={colors.success} strokeWidth={3} />
              </View>
              <Text style={styles.benefitText}>{benefit}</Text>
            </View>
          ))}
        </View>

        <TouchableOpacity onPress={onUnlock} disabled={isProcessingPurchase} activeOpacity={0.85} accessibilityRole="button">
          <PremiumGradient style={styles.cta} disabled={isProcessingPurchase}>
            <Text style={styles.ctaText}>Unlock Premium · {productPrice}</Text>
          </PremiumGradient>
        </TouchableOpacity>
        <Text style={styles.terms}>One-time purchase. No subscription.</Text>

        <TouchableOpacity onPress={onDismiss} style={styles.notNow} accessibilityRole="button">
          <Text style={styles.notNowText}>Not now</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles(({ colors, shadows }) => ({
  backdrop: {
    flex: 1,
    backgroundColor: colors.scrim,
  },
  sheet: {
    backgroundColor: colors.surfaceElevated,
    borderTopLeftRadius: borderRadius.xxl,
    borderTopRightRadius: borderRadius.xxl,
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.md,
    ...shadows.elevated,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.glassStrong,
    marginBottom: spacing.lg,
  },
  logo: {
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.textPrimary,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 15,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.sm,
    lineHeight: 21,
  },
  benefits: {
    marginVertical: spacing.xl,
    gap: spacing.md,
  },
  benefitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  check: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.successMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  benefitText: {
    flex: 1,
    fontSize: 15,
    color: colors.textPrimary,
  },
  cta: {
    borderRadius: borderRadius.lg,
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
  ctaText: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.onPrimary,
  },
  terms: {
    fontSize: 13,
    color: colors.textTertiary,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  notNow: {
    alignSelf: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    marginTop: spacing.xs,
  },
  notNowText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textSecondary,
  },
}));
