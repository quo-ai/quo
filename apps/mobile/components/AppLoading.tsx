import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, Animated } from 'react-native';
import { brand, spacing, typography } from '@/constants/theme';
import { QuoLogo } from '@/components/brand/QuoLogo';

// Shown straight after the native splash (solid brand indigo, white logo
// centred), so it uses the brand colours in both schemes and keeps the logo
// dead centre — the label hangs below it without shifting it.
// Matches the native Android 12+ splash mark (288dp canvas, scripts/generate-brand-assets.py)
// so the hand-off from splash to this screen is seamless.
const LOGO_SIZE = 167;

export function AppLoading() {
  const fadeAnim = useRef(new Animated.Value(0.5)).current;
  const [dotCount, setDotCount] = useState(0);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(fadeAnim, {
          toValue: 0.5,
          duration: 800,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [fadeAnim]);

  useEffect(() => {
    const interval = setInterval(() => {
      setDotCount((prev) => (prev + 1) % 4);
    }, 450);
    return () => clearInterval(interval);
  }, []);

  const text = `Quo${'.'.repeat(dotCount)}`;

  return (
    <View style={styles.container}>
      <View>
        <QuoLogo size={LOGO_SIZE} color={brand.white} backgroundColor={brand.indigo} ringWidth={26} />
        <Animated.Text style={[styles.text, { opacity: fadeAnim }]}>
          {text}
        </Animated.Text>
      </View>
    </View>
  );
}

// Brand-fixed (not themed): must match the native splash in both schemes.
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: brand.indigo,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  text: {
    position: 'absolute',
    top: '100%',
    left: -spacing.xxxl,
    right: -spacing.xxxl,
    marginTop: spacing.xl,
    textAlign: 'center',
    fontSize: typography.sizes.xl,
    fontWeight: typography.weights.semibold,
    color: brand.white,
    letterSpacing: 0.5,
  },
});
