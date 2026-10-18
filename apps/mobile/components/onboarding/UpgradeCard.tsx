import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Dimensions } from 'react-native';
import { Sparkles } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/hooks/useTheme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const isTablet = SCREEN_WIDTH >= 768;

interface UpgradeCardProps {
  productPrice: string;
  onPress: () => void;
}

// Premium upsell card shown below the family list for free users
export function UpgradeCard({ productPrice, onPress }: UpgradeCardProps) {
  const styles = useStyles();
  const { colors, isDark } = useTheme();
  return (
    <TouchableOpacity
      style={styles.upgradeCard}
      onPress={onPress}
      activeOpacity={0.9}
    >
      <BlurView intensity={60} tint={isDark ? 'dark' : 'light'} style={styles.upgradeBlur}>
        <View style={styles.upgradeGlassContainer}>
          <LinearGradient
            colors={[colors.secondaryMuted, colors.primaryMuted]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.upgradeGlassOverlay}
          />
          <View style={styles.upgradeContent}>
            <View style={styles.upgradeIconContainer}>
              <Sparkles size={28} color={colors.secondary} />
            </View>
            <View style={styles.upgradeTextContainer}>
              <Text style={styles.upgradeLabel}>PREMIUM</Text>
              <Text style={styles.upgradeTitle}>Unlock All Models</Text>
              <Text style={styles.upgradeSubtitle}>Vision, reasoning, larger models, and custom model support. One payment, yours forever.</Text>
            </View>
          </View>
          <View style={styles.upgradePriceRow}>
            <View style={styles.upgradePriceBadge}>
              <Text style={styles.upgradePrice}>{productPrice}</Text>
            </View>
            <View style={styles.upgradePriceLabelContainer}>
              <Text style={styles.upgradePriceLabel}>one-time, no subscription</Text>
              <Text style={styles.upgradePriceDisclaimer}>Price may increase</Text>
            </View>
          </View>
          <View style={styles.upgradeGlow} />
        </View>
      </BlurView>
    </TouchableOpacity>
  );
}

// Upgrade card styles - flat brand card with a soft premium tint
const useStyles = makeStyles(({ colors, shadows }) => ({
  upgradeCard: {
    marginTop: spacing.lg,
    borderRadius: 28,
    overflow: 'hidden',
    ...shadows.soft,
  },
  upgradeBlur: {
    borderRadius: 28,
    overflow: 'hidden',
  },
  upgradeGlassContainer: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: 28,
    borderWidth: 2,
    borderColor: colors.secondaryGlow,
    overflow: 'hidden',
    position: 'relative',
    padding: spacing.lg,
  },
  upgradeGlassOverlay: {
    ...StyleSheet.absoluteFill,
    borderRadius: 28,
  },
  upgradeContent: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: spacing.md,
    position: 'relative',
    zIndex: 2,
  },
  upgradeIconContainer: {
    width: isTablet ? 64 : 56,
    height: isTablet ? 64 : 56,
    borderRadius: isTablet ? 32 : 28,
    backgroundColor: colors.secondaryMuted,
    borderWidth: 2,
    borderColor: colors.secondaryGlow,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  upgradeTextContainer: {
    flex: 1,
    paddingTop: 4,
  },
  upgradeLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.secondary,
    letterSpacing: 1.2,
    marginBottom: 4,
  },
  upgradeTitle: {
    fontSize: isTablet ? 24 : 22,
    fontWeight: '800',
    color: colors.textPrimary,
    marginBottom: 6,
    letterSpacing: -0.5,
  },
  upgradeSubtitle: {
    fontSize: isTablet ? 15 : 14,
    color: colors.textSecondary,
    lineHeight: isTablet ? 22 : 20,
    fontWeight: '500',
  },
  upgradePriceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    position: 'relative',
    zIndex: 2,
  },
  upgradePriceBadge: {
    backgroundColor: colors.secondaryMuted,
    borderWidth: 2,
    borderColor: colors.secondaryGlow,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 16,
  },
  upgradePrice: {
    fontSize: isTablet ? 32 : 28,
    fontWeight: '800',
    color: colors.secondary,
    letterSpacing: -1,
  },
  upgradePriceLabelContainer: {
    alignItems: 'flex-end',
  },
  upgradePriceLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  upgradePriceDisclaimer: {
    fontSize: 10,
    color: colors.secondary,
    opacity: 0.7,
    marginTop: 2,
    fontWeight: '500',
  },
  upgradeGlow: {
    position: 'absolute',
    bottom: -30,
    right: -30,
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: colors.secondaryMuted,
    zIndex: 1,
  },
  upgradeHighlight: {
    position: 'absolute',
    bottom: 0,
    left: spacing.lg,
    right: spacing.lg,
    height: 1,
    backgroundColor: colors.primaryMuted,
  },
}));
