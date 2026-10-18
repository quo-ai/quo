import React, { useEffect, useState } from 'react';
import { Animated, AppState, Text, StyleSheet, View, TextStyle } from 'react-native';
import MaskedView from '@react-native-masked-view/masked-view';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '@/hooks/useTheme';

interface ShimmerTextProps {
  text: string;
  style?: TextStyle;
  shimmerColor?: string;
  baseColor?: string;
  duration?: number;
}

export function ShimmerText({
  text,
  style,
  shimmerColor,
  baseColor,
  duration = 2000,
}: ShimmerTextProps) {
  const { colors } = useTheme();
  const shimmer = shimmerColor ?? colors.textSecondary;
  const base = baseColor ?? colors.textMuted;
  const [shimmerAnim] = useState(() => new Animated.Value(0));
  // The loop is infinite; don't keep it ticking while the app is backgrounded.
  const [appActive, setAppActive] = useState(() => AppState.currentState === 'active');

  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => setAppActive(state === 'active'));
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!appActive) return;
    shimmerAnim.setValue(0);
    const animation = Animated.loop(
      Animated.timing(shimmerAnim, {
        toValue: 1,
        duration,
        useNativeDriver: true,
      })
    );
    animation.start();
    return () => animation.stop();
  }, [shimmerAnim, duration, appActive]);

  const translateX = shimmerAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [-100, 200],
  });

  return (
    <View style={styles.container}>
      {/* Base text layer */}
      <Text style={[style, { color: base }]}>{text}</Text>
      
      {/* Shimmer overlay */}
      <View style={StyleSheet.absoluteFill}>
        <MaskedView
          style={StyleSheet.absoluteFill}
          maskElement={
            // Only the mask's alpha matters; any opaque colour works.
            <Text style={[style, { color: colors.textPrimary }]}>{text}</Text>
          }
        >
          <Animated.View
            style={[
              styles.shimmerContainer,
              { transform: [{ translateX }] },
            ]}
          >
            <LinearGradient
              colors={['transparent', shimmer, 'transparent']}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={styles.gradient}
            />
          </Animated.View>
        </MaskedView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
  },
  shimmerContainer: {
    width: 100,
    height: '100%',
  },
  gradient: {
    flex: 1,
    width: 100,
  },
});
