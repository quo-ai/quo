import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Dimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { ChevronRight, Sparkles, Mic, Image, Brain, Cpu } from 'lucide-react-native';
import { spacing, borderRadius, typography } from '@/constants/theme';
import { makeStyles, useTheme } from '@/hooks/useTheme';
import { QuoLogo } from '@/components/brand/QuoLogo';
import { usePremium } from '@/contexts/PremiumContext';
import { PremiumGradient } from '@/components/premium/PremiumGradient';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const isTablet = SCREEN_WIDTH >= 768;

interface UpgradeBannerProps {
  variant?: 'compact' | 'full';
  onPress: () => void;
}

export function UpgradeBanner({ variant = 'compact', onPress }: UpgradeBannerProps) {
  const { productPrice } = usePremium();
  const styles = useStyles();
  const { colors, isDark } = useTheme();
  if (variant === 'full') {
    return (
      <TouchableOpacity
        style={styles.fullContainer}
        onPress={onPress}
        activeOpacity={0.9}
      >
        <BlurView intensity={60} tint={isDark ? 'dark' : 'light'} style={styles.fullBlur}>
          <View style={styles.fullGlassBase}>
            {/* Soft premium tint */}
            <LinearGradient
              colors={[colors.secondaryMuted, colors.primaryMuted]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.fullGradientOverlay}
            />
            {/* Glow effect */}
            <View style={styles.fullGlow} />
            
            {/* Content */}
            <View style={styles.fullContent}>
          {/* Header row */}
          <View style={styles.fullHeader}>
            <View style={styles.fullIconWrapper}>
              <Sparkles size={18} color={colors.secondary} />
            </View>
            <View style={styles.fullTitleContainer}>
              <Text style={styles.fullTitle}>Unlock Premium</Text>
              <Text style={styles.fullSubtitle}>One-time purchase</Text>
              <Text style={styles.fullDisclaimer}>Price may increase, lock in now!</Text>
            </View>
            <View style={styles.fullPriceBadge}>
              <Text style={styles.fullPrice}>{productPrice}</Text>
            </View>
          </View>
          
          {/* Feature pills */}
          <View style={styles.fullFeatures}>
            <View style={styles.featurePill}>
              <Mic size={12} color={colors.textSecondary} />
              <Text style={styles.featurePillText}>Voice</Text>
            </View>
            <View style={styles.featurePill}>
              <Image size={12} color={colors.textSecondary} />
              <Text style={styles.featurePillText}>Vision</Text>
            </View>
            <View style={styles.featurePill}>
              <Brain size={12} color={colors.textSecondary} />
              <Text style={styles.featurePillText}>Thinking</Text>
            </View>
            <View style={styles.featurePill}>
              <Cpu size={12} color={colors.textSecondary} />
              <Text style={styles.featurePillText}>Models</Text>
            </View>
          </View>
          
              {/* CTA */}
              <View style={styles.fullCTA}>
                <PremiumGradient style={styles.fullCTAGradient}>
                  <Text style={styles.fullCTAText}>View Details</Text>
                  <ChevronRight size={16} color={colors.onPrimary} />
                </PremiumGradient>
              </View>
            </View>
          </View>
        </BlurView>
      </TouchableOpacity>
    );
  }

  // Compact variant for drawer/sidebar
  return (
    <TouchableOpacity
      style={styles.compactContainer}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <View style={styles.compactGlassLayer} />
      <View style={styles.compactRow}>
        <View style={styles.compactAppIconWrap}>
          <QuoLogo size={30} backgroundColor={colors.surfaceElevated} sparkles={false} ringWidth={32} />
        </View>
        <View style={styles.compactTextContainer}>
          <Text style={styles.compactTitle}>Go Premium</Text>
          <Text style={styles.compactSubtitle}>Lifetime access</Text>
        </View>
        <View style={styles.compactRight}>
          <View style={styles.compactPriceBadge}>
            <Text style={styles.compactPrice}>{productPrice}</Text>
          </View>
          <ChevronRight size={16} color={colors.textTertiary} />
        </View>
      </View>
    </TouchableOpacity>
  );
}

const useStyles = makeStyles(({ colors, shadows }) => ({
  // Full variant - flat brand card with a soft premium tint
  fullContainer: {
    marginBottom: spacing.lg,
    borderRadius: 28,
    overflow: 'hidden',
    position: 'relative',
    ...shadows.soft,
  },
  fullBlur: {
    borderRadius: 28,
    overflow: 'hidden',
  },
  fullGlassBase: {
    backgroundColor: colors.surfaceElevated,
    borderWidth: 2,
    borderColor: colors.secondaryGlow,
    borderRadius: 28,
    position: 'relative',
    overflow: 'hidden',
  },
  fullGradientOverlay: {
    ...StyleSheet.absoluteFill,
    borderRadius: 28,
  },
  fullGlow: {
    position: 'absolute',
    bottom: -40,
    right: -40,
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: colors.secondaryMuted,
    zIndex: 1,
  },
  fullContent: {
    padding: spacing.lg,
    position: 'relative',
    zIndex: 2,
  },
  fullHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  fullIconWrapper: {
    width: isTablet ? 56 : 48,
    height: isTablet ? 56 : 48,
    borderRadius: isTablet ? 28 : 24,
    backgroundColor: colors.secondaryMuted,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.secondaryGlow,
  },
  fullTitleContainer: {
    flex: 1,
    marginLeft: spacing.md,
  },
  fullTitle: {
    fontSize: isTablet ? 22 : 20,
    fontWeight: '800',
    color: colors.textPrimary,
    letterSpacing: -0.5,
  },
  fullSubtitle: {
    fontSize: isTablet ? 14 : 13,
    color: colors.secondary,
    marginTop: 2,
    fontWeight: '600',
  },
  fullDisclaimer: {
    fontSize: 10,
    color: colors.secondary,
    opacity: 0.7,
    marginTop: 2,
    fontWeight: '500',
  },
  fullPriceBadge: {
    backgroundColor: colors.secondaryMuted,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: colors.secondaryGlow,
  },
  fullPrice: {
    fontSize: isTablet ? 20 : 18,
    fontWeight: '800',
    color: colors.secondary,
    letterSpacing: -0.5,
  },
  fullFeatures: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  featurePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.secondaryMuted,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.secondaryGlow,
  },
  featurePillText: {
    fontSize: 12,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  fullCTA: {
    borderRadius: 18,
    overflow: 'hidden',
  },
  fullCTAGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    gap: 6,
  },
  fullCTAText: {
    fontSize: isTablet ? 16 : 15,
    fontWeight: '800',
    color: colors.onPrimary,
    letterSpacing: -0.3,
  },
  compactContainer: {
    borderRadius: 20,
    overflow: 'hidden',
    position: 'relative',
    ...shadows.soft,
  },
  compactGlassLayer: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 2,
    borderColor: colors.secondaryGlow,
    borderRadius: 20,
  },
  compactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.lg,
  },
  compactAppIconWrap: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.lg,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  compactTextContainer: {
    flex: 1,
    marginLeft: spacing.md,
  },
  compactTitle: {
    fontSize: typography.sizes.md,
    fontWeight: '800',
    color: colors.textPrimary,
    letterSpacing: -0.3,
  },
  compactSubtitle: {
    fontSize: typography.sizes.sm,
    color: colors.secondary,
    marginTop: 2,
    fontWeight: '600',
  },
  compactRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  compactPriceBadge: {
    backgroundColor: colors.secondaryMuted,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.secondaryGlow,
  },
  compactPrice: {
    fontSize: typography.sizes.sm,
    fontWeight: '800',
    color: colors.secondary,
    letterSpacing: -0.3,
  },
}));
