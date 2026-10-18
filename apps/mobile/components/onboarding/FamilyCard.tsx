import React from 'react';
import { View, Text, TouchableOpacity, Dimensions } from 'react-native';
import { Lock, Eye, Brain, Wrench, ChevronRight } from 'lucide-react-native';
import { spacing, borderRadius } from '@/constants/theme';
import { makeStyles, useTheme } from '@/hooks/useTheme';
import {
  ModelFamily,
  getFamilyFeatures,
  getFamilySizeRange,
} from '@/components/onboarding/modelGrouping';
import {
  PremiumBadge,
  DownloadedBadge,
  RecommendedBadge,
  FastestBadge,
  BestBadge,
} from '@/components/onboarding/Badges';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const isTablet = SCREEN_WIDTH >= 768;

interface FamilyCardProps {
  family: ModelFamily;
  isLocked: boolean;
  hasDownloaded: boolean;
  disabled: boolean;
  onPress: (family: ModelFamily) => void;
}

// Card row for a model family on the main picker screen
export function FamilyCard({ family, isLocked, hasDownloaded, disabled, onPress }: FamilyCardProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  const features = getFamilyFeatures(family);
  const sizeRange = getFamilySizeRange(family);
  const variantCount = family.models.length;

  return (
    <TouchableOpacity
      style={[
        styles.familyCard,
        isLocked && styles.familyCardLocked,
      ]}
      onPress={() => onPress(family)}
      disabled={disabled}
      activeOpacity={0.7}
    >
      <View style={styles.familyInfo}>
        <View style={styles.familyHeader}>
          <Text style={[styles.familyName, isLocked && styles.familyNameLocked]}>
            {family.name}
          </Text>
          {family.badge === 'fastest' && <FastestBadge />}
          {family.badge === 'recommended' && <RecommendedBadge />}
          {family.badge === 'best' && <BestBadge />}
          {isLocked && <PremiumBadge />}
          {hasDownloaded && !isLocked && <DownloadedBadge checkSize={12} />}
        </View>
        <Text style={styles.familyDescription}>{family.description}</Text>
        <View style={styles.familyMeta}>
          <Text style={styles.familySize}>{sizeRange}</Text>
          {family.id !== 'custom' && (
            <Text style={styles.familyVariants}>{variantCount} version{variantCount > 1 ? 's' : ''}</Text>
          )}
        </View>
        <View style={styles.familyFeatures}>
          {features.hasTools && (
            <View style={styles.featureBadge}>
              <Wrench size={12} color={colors.primary} />
              <Text style={styles.featureText}>Tools</Text>
            </View>
          )}
          {features.hasVision && (
            <View style={styles.featureBadge}>
              <Eye size={12} color={colors.secondary} />
              <Text style={styles.featureText}>Vision</Text>
            </View>
          )}
          {features.hasReasoning && (
            <View style={styles.featureBadge}>
              <Brain size={12} color={colors.warning} />
              <Text style={styles.featureText}>Reasoning</Text>
            </View>
          )}
        </View>
      </View>

      <View style={styles.familyAction}>
        {isLocked ? (
          <View style={styles.lockedIcon}>
            <Lock size={20} color={colors.secondary} />
          </View>
        ) : (
          <ChevronRight size={24} color={colors.textSecondary} />
        )}
      </View>
    </TouchableOpacity>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  familyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.glassMedium,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    padding: spacing.lg,
  },
  familyCardLocked: {
    borderColor: colors.secondaryGlow,
    backgroundColor: colors.secondaryMuted,
  },
  familyInfo: {
    flex: 1,
  },
  familyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  familyName: {
    fontSize: isTablet ? 20 : 18,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  familyNameLocked: {
    color: colors.textSecondary,
  },
  familyDescription: {
    fontSize: isTablet ? 15 : 14,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  familyMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  familySize: {
    fontSize: 12,
    color: colors.textTertiary,
  },
  familyVariants: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.textSecondary,
    backgroundColor: colors.glassStrong,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
  },
  familyAction: {
    marginLeft: spacing.md,
  },
  familyFeatures: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  featureBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.glassStrong,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: borderRadius.md,
  },
  featureText: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  lockedIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.secondaryMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
}));
