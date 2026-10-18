import React from 'react';
import { Animated, Text } from 'react-native';
import { spacing, borderRadius } from '@/constants/theme';
import { makeStyles } from '@/hooks/useTheme';

interface InlineToastProps {
  text: string | null;
  anim: Animated.Value;
}

export function InlineToast({ text, anim }: InlineToastProps) {
  const styles = useStyles();
  if (!text) return null;
  return (
    <Animated.View style={[styles.inlineToast, { opacity: anim }]} pointerEvents="none">
      <Text style={styles.inlineToastText} numberOfLines={2}>{text}</Text>
    </Animated.View>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  inlineToast: {
    position: 'absolute',
    top: -44,
    left: spacing.lg,
    right: spacing.lg,
    alignItems: 'center',
    zIndex: 100,
  },
  inlineToastText: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.onInverseSurface,
    backgroundColor: colors.inverseSurface,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    overflow: 'hidden',
    textAlign: 'center',
  },
}));
