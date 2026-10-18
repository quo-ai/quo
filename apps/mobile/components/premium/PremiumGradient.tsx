import React, { ReactNode } from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '@/hooks/useTheme';

// Brand CTA gradient shared by the paywall, upgrade banner and review prompt
// so the three surfaces can't drift apart. Indigo → violet on light; on dark
// the light-tinted `secondary` would wash out the white label, so the fill
// stays in the indigo family (indigo → softer indigo).

/** Gradient stops for premium CTAs; both ends keep white text legible. */
export function usePremiumGradientColors(): readonly [string, string] {
  const { colors, isDark } = useTheme();
  return [colors.primaryFill, isDark ? colors.primaryDim : colors.secondary];
}

interface PremiumGradientProps {
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
  children?: ReactNode;
}

/** Diagonal brand gradient fill for premium CTAs. */
export function PremiumGradient({ style, disabled, children }: PremiumGradientProps) {
  const gradient = usePremiumGradientColors();
  return (
    <LinearGradient
      colors={gradient}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[style, disabled && { opacity: 0.6 }]}
    >
      {children}
    </LinearGradient>
  );
}
