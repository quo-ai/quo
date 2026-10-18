import React from 'react';
import { View, Text, TextStyle } from 'react-native';
import { Check, Lock } from 'lucide-react-native';
import { spacing, borderRadius } from '@/constants/theme';
import { makeStyles, useTheme } from '@/hooks/useTheme';

// Shared badge components used by both the family cards and the variant picker

interface BadgeProps {
  label: string;
  color: string;
  backgroundColor: string;
  icon?: React.ReactNode;
  fontSize?: number;
  fontWeight?: TextStyle['fontWeight'];
  gap?: number;
  paddingHorizontal?: number;
  borderColor?: string;
}

function Badge({
  label,
  color,
  backgroundColor,
  icon,
  fontSize = 10,
  fontWeight = '600',
  gap = 4,
  paddingHorizontal = spacing.sm,
  borderColor,
}: BadgeProps) {
  const styles = useStyles();
  return (
    <View
      style={[
        styles.badge,
        { backgroundColor, gap, paddingHorizontal },
        borderColor ? { borderWidth: 1, borderColor } : null,
      ]}
    >
      {icon}
      <Text style={{ fontSize, fontWeight, color }}>{label}</Text>
    </View>
  );
}

export function PremiumBadge() {
  const { colors } = useTheme();
  return (
    <Badge
      label="Premium"
      color={colors.secondary}
      backgroundColor={colors.secondaryMuted}
      icon={<Lock size={10} color={colors.secondary} />}
      fontSize={11}
      fontWeight="700"
      gap={3}
      paddingHorizontal={6}
      borderColor={colors.secondaryGlow}
    />
  );
}

export function DownloadedBadge({ checkSize }: { checkSize: number }) {
  const { colors } = useTheme();
  return (
    <Badge
      label="Ready"
      color={colors.success}
      backgroundColor={colors.successMuted}
      icon={<Check size={checkSize} color={colors.success} />}
      fontSize={11}
    />
  );
}

export function RecommendedBadge() {
  const { colors } = useTheme();
  return (
    <Badge
      label="Recommended"
      color={colors.success}
      backgroundColor={colors.successMuted}
    />
  );
}

export function FastestBadge() {
  const { colors } = useTheme();
  return (
    <Badge
      label="Fastest"
      color={colors.primary}
      backgroundColor={colors.primaryMuted}
    />
  );
}

export function BestBadge() {
  const { colors } = useTheme();
  return (
    <Badge
      label="Highest Quality"
      color={colors.secondary}
      backgroundColor={colors.secondaryMuted}
    />
  );
}

export function FreeBadge() {
  const { colors } = useTheme();
  return (
    <Badge
      label="Free"
      color={colors.success}
      backgroundColor={colors.successMuted}
    />
  );
}

export function ActiveBadge() {
  const { colors } = useTheme();
  return (
    <Badge
      label="Active"
      color={colors.primary}
      backgroundColor={colors.primaryMuted}
    />
  );
}

const useStyles = makeStyles(() => ({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
  },
}));
