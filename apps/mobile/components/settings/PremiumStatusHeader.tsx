import React from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Crown, RotateCcw, ChevronRight } from 'lucide-react-native';
import { UpgradeBanner } from '@/components/UpgradeBanner';
import { spacing, borderRadius, typography } from '@/constants/theme';
import { makeStyles, useTheme } from '@/hooks/useTheme';

interface PremiumStatusHeaderProps {
  isPremium: boolean;
  hasActivated: boolean;
  openUpgradeModal: (featureName?: string) => void;
  restorePurchases: () => void;
  isProcessingPurchase: boolean;
}

export function PremiumStatusHeader({
  isPremium,
  hasActivated,
  openUpgradeModal,
  restorePurchases,
  isProcessingPurchase,
}: PremiumStatusHeaderProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <>
      {/* Premium Upgrade Banner - Only show for free users */}
      {!isPremium && hasActivated && (
        <UpgradeBanner variant="full" onPress={() => openUpgradeModal()} />
      )}

      {/* Restore - reachable before the first answer too (reinstall / new
          device), when the upgrade banner is still hidden. */}
      {!isPremium && (
        <TouchableOpacity
          style={styles.restoreRow}
          onPress={restorePurchases}
          disabled={isProcessingPurchase}
          activeOpacity={0.7}
        >
          <View style={styles.restoreRowContent}>
            <RotateCcw size={18} color={colors.textSecondary} />
            <View style={styles.restoreRowText}>
              <Text style={styles.restoreRowLabel}>Restore Purchases</Text>
              <Text style={styles.restoreRowSubtext}>Already bought Premium? Unlock it on this device.</Text>
            </View>
          </View>
          {isProcessingPurchase
            ? <ActivityIndicator size="small" color={colors.textTertiary} />
            : <ChevronRight size={18} color={colors.textTertiary} />}
        </TouchableOpacity>
      )}

      {/* Premium Status Card - Only show for premium users */}
      {isPremium && (
        <View style={styles.premiumStatusCard}>
          <View style={styles.premiumStatusIcon}>
            <Crown size={20} color={colors.secondary} />
          </View>
          <View style={styles.premiumStatusText}>
            <Text style={styles.premiumStatusTitle}>Premium Active</Text>
            <Text style={styles.premiumStatusSubtitle}>All features unlocked</Text>
          </View>
        </View>
      )}

      {/* Dev-only paywall preview: premium hides every UpgradeModal entry
          point, so styling work needs a way to open it regardless. */}
      {__DEV__ && isPremium && (
        <TouchableOpacity
          style={styles.devPaywallPreview}
          onPress={() => openUpgradeModal()}
          activeOpacity={0.7}
        >
          <Text style={styles.devPaywallPreviewText}>Preview paywall (dev build only)</Text>
        </TouchableOpacity>
      )}
    </>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  // Premium status card styles
  premiumStatusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.secondaryMuted,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.secondaryGlow,
    padding: spacing.md,
    marginBottom: spacing.xl,
  },
  restoreRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.glassMedium,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    padding: spacing.md,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.xl,
  },
  restoreRowContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    flex: 1,
  },
  restoreRowText: {
    flex: 1,
  },
  restoreRowLabel: {
    fontSize: typography.sizes.md,
    fontWeight: typography.weights.medium,
    color: colors.textPrimary,
  },
  restoreRowSubtext: {
    fontSize: typography.sizes.sm,
    color: colors.textSecondary,
    marginTop: 2,
  },
  devPaywallPreview: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
    marginTop: -spacing.lg,
    marginBottom: spacing.xl,
  },
  devPaywallPreviewText: {
    fontSize: 13,
    color: colors.secondary,
    fontWeight: '600',
  },
  premiumStatusIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.secondaryMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  premiumStatusText: {
    marginLeft: spacing.md,
  },
  premiumStatusTitle: {
    fontSize: typography.sizes.md,
    fontWeight: typography.weights.semibold,
    color: colors.secondary,
  },
  premiumStatusSubtitle: {
    fontSize: typography.sizes.sm,
    color: colors.textSecondary,
    marginTop: 2,
  },
}));
