import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Linking,
  Dimensions,
  Platform,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import * as StoreReview from 'expo-store-review';
import { Star, X } from 'lucide-react-native';
import { spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/hooks/useTheme';
import { PremiumGradient } from '@/components/premium/PremiumGradient';
import { getMessageCount } from '@/utils/reviewPrompt';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const isTablet = SCREEN_WIDTH >= 768;

const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.quo.app';

// "Maybe Later" snooze. The caller's dismiss handler marks the prompt shown
// (utils/reviewPrompt's '@review_prompt_shown'); a snooze records when to
// clear that flag again so the prompt can re-appear after more answers.
const REVIEW_SHOWN_KEY = '@review_prompt_shown'; // owned by utils/reviewPrompt
const REVIEW_SNOOZE_KEY = '@review_prompt_snooze';
const SNOOZE_ANSWERS = 20;
const MAX_SNOOZES = 2;

interface ReviewSnooze {
  untilCount: number;
  count: number;
}

async function readSnooze(): Promise<ReviewSnooze | null> {
  try {
    const raw = await AsyncStorage.getItem(REVIEW_SNOOZE_KEY);
    return raw ? JSON.parse(raw) as ReviewSnooze : null;
  } catch {
    return null;
  }
}

async function snoozeReviewPrompt(): Promise<void> {
  try {
    const previous = await readSnooze();
    const count = (previous?.count ?? 0) + 1;
    if (count > MAX_SNOOZES) return; // asked enough; leave it dismissed
    const untilCount = (await getMessageCount()) + SNOOZE_ANSWERS;
    await AsyncStorage.setItem(REVIEW_SNOOZE_KEY, JSON.stringify({ untilCount, count }));
  } catch {
    // Best-effort; worst case the prompt stays dismissed.
  }
}

/** Re-arms the prompt once a snooze has elapsed (checked on mount). */
async function releaseElapsedSnooze(): Promise<void> {
  try {
    const snooze = await readSnooze();
    if (!snooze || snooze.untilCount <= 0) return;
    if ((await getMessageCount()) < snooze.untilCount) return;
    await AsyncStorage.removeItem(REVIEW_SHOWN_KEY);
    // Keep the snooze count so MAX_SNOOZES still applies.
    await AsyncStorage.setItem(REVIEW_SNOOZE_KEY, JSON.stringify({ untilCount: 0, count: snooze.count }));
  } catch {
    // Ignore.
  }
}

interface ReviewPromptProps {
  visible: boolean;
  onDismiss: () => void;
  onRate: () => void;
}

export function ReviewPrompt({ visible, onDismiss, onRate }: ReviewPromptProps) {
  // iOS: use the native SKStoreReviewController prompt instead of a custom
  // modal (Apple rejects custom review UIs that redirect to the store).
  // Eligibility gating stays in the caller (utils/reviewPrompt); this fires at
  // most once per `visible` transition.
  const iosRequestedRef = useRef(false);
  const styles = useStyles();
  const { colors, isDark } = useTheme();

  useEffect(() => {
    void releaseElapsedSnooze();
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    if (!visible) {
      iosRequestedRef.current = false;
      return;
    }
    if (iosRequestedRef.current) return;
    iosRequestedRef.current = true;

    (async () => {
      try {
        if (await StoreReview.isAvailableAsync()) {
          await StoreReview.requestReview();
          // The native sheet gives no rated/dismissed signal; treat it as
          // rated so the caller marks the prompt shown and never re-asks.
          onRate();
        } else {
          onDismiss();
        }
      } catch (error) {
        console.error('Error requesting native review:', error);
        onDismiss();
      }
    })();
  }, [visible, onRate, onDismiss]);

  if (!visible) return null;
  // Native prompt handles the whole flow on iOS — render no custom UI.
  if (Platform.OS === 'ios') return null;

  const handleMaybeLater = () => {
    onDismiss();
    void snoozeReviewPrompt();
  };

  const handleRate = async () => {
    try {
      const supported = await Linking.canOpenURL(PLAY_STORE_URL);
      if (supported) {
        await Linking.openURL(PLAY_STORE_URL);
        onRate();
      }
    } catch (error) {
      console.error('Error opening Play Store:', error);
    }
  };

  return (
    <View style={styles.overlay}>
      <BlurView intensity={60} tint={isDark ? 'dark' : 'light'} style={styles.blurContainer}>
        <View style={styles.container}>
          {/* Soft brand tint */}
          <LinearGradient
            colors={[colors.secondaryMuted, colors.primaryMuted]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.gradientOverlay}
          />

          {/* Glow effect */}
          <View style={styles.glow} />

          {/* Content */}
          <View style={styles.content}>
            {/* Icon */}
            <View style={styles.iconContainer}>
              <Star size={isTablet ? 32 : 28} color={colors.warning} fill={colors.warning} />
            </View>

            {/* Text */}
            <View style={styles.textContainer}>
              <Text style={styles.title}>Enjoying the app?</Text>
              <Text style={styles.subtitle}>
                Help us grow by leaving a review on the Play Store
              </Text>
            </View>

            {/* Actions */}
            <View style={styles.actions}>
              <TouchableOpacity
                style={styles.dismissButton}
                onPress={handleMaybeLater}
                activeOpacity={0.7}
              >
                <Text style={styles.dismissText}>Maybe Later</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.rateButton}
                onPress={handleRate}
                activeOpacity={0.85}
              >
                <PremiumGradient style={styles.rateGradient}>
                  <Star size={16} color={colors.onPrimary} fill={colors.onPrimary} />
                  <Text style={styles.rateText}>Rate on Play Store</Text>
                </PremiumGradient>
              </TouchableOpacity>
            </View>

            {/* Close button */}
            <TouchableOpacity
              style={styles.closeButton}
              onPress={onDismiss}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <View style={styles.closeButtonInner}>
                <X size={16} color={colors.textSecondary} />
              </View>
            </TouchableOpacity>
          </View>
        </View>
      </BlurView>
    </View>
  );
}

const useStyles = makeStyles(({ colors, shadows }) => ({
  overlay: {
    position: 'absolute',
    bottom: 80,
    left: 0,
    right: 0,
    paddingHorizontal: spacing.lg,
    zIndex: 1000,
  },
  blurContainer: {
    borderRadius: 24,
    overflow: 'hidden',
  },
  container: {
    backgroundColor: colors.surfaceElevated,
    borderWidth: 2,
    borderColor: colors.secondaryGlow,
    borderRadius: 24,
    position: 'relative',
    overflow: 'hidden',
    ...shadows.soft,
  },
  gradientOverlay: {
    ...StyleSheet.absoluteFill,
    borderRadius: 24,
  },
  glow: {
    position: 'absolute',
    bottom: -30,
    right: -30,
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: colors.secondaryMuted,
    zIndex: 1,
  },
  content: {
    padding: spacing.lg,
    position: 'relative',
    zIndex: 2,
  },
  iconContainer: {
    width: isTablet ? 64 : 56,
    height: isTablet ? 64 : 56,
    borderRadius: isTablet ? 32 : 28,
    backgroundColor: colors.warningMuted,
    borderWidth: 2,
    borderColor: colors.warningBorder,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  textContainer: {
    marginBottom: spacing.lg,
  },
  title: {
    fontSize: isTablet ? 22 : 20,
    fontWeight: '800',
    color: colors.textPrimary,
    marginBottom: spacing.xs,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: isTablet ? 15 : 14,
    color: colors.textSecondary,
    lineHeight: isTablet ? 22 : 20,
    fontWeight: '500',
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  dismissButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    backgroundColor: colors.glass,
  },
  dismissText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  rateButton: {
    flex: 1,
    borderRadius: 16,
    overflow: 'hidden',
  },
  rateGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    gap: spacing.xs,
  },
  rateText: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.onPrimary,
    letterSpacing: -0.3,
  },
  closeButton: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    zIndex: 10,
  },
  closeButtonInner: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.glassMedium,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
}));
