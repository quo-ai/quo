import React, { useEffect, useRef } from 'react';
import { View, Animated } from 'react-native';
import { Sparkles } from 'lucide-react-native';
import { spacing, borderRadius } from '@/constants/theme';
import { makeStyles, useTheme } from '@/hooks/useTheme';
import { ShimmerText } from './ShimmerText';

interface LoadingIndicatorProps {
  message?: string;
}

export function LoadingIndicator({ message = 'Thinking...' }: LoadingIndicatorProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  const pulseAnim = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0.4,
          duration: 800,
          useNativeDriver: true,
        }),
      ])
    );

    pulse.start();

    return () => pulse.stop();
  }, [pulseAnim]);

  return (
    <View style={styles.container}>
      <View style={styles.iconContainer}>
        <Animated.View style={{ opacity: pulseAnim }}>
          <Sparkles size={16} color={colors.primary} strokeWidth={2} />
        </Animated.View>
      </View>
      <ShimmerText 
        text={message} 
        style={styles.message}
        baseColor={colors.textMuted}
        shimmerColor={colors.textSecondary}
        duration={1500}
      />
    </View>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    marginLeft: spacing.lg,
  },
  iconContainer: {
    width: 28,
    height: 28,
    borderRadius: borderRadius.md,
    backgroundColor: colors.primaryMuted,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  message: {
    fontSize: 15,
    color: colors.textTertiary,
  },
}));
