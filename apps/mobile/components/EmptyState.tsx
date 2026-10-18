import React, { useEffect, useState } from 'react';
import { View, Text, Animated, TouchableOpacity } from 'react-native';
import { Shield, Zap, MessageCircle, WifiOff } from 'lucide-react-native';
import { spacing, borderRadius } from '@/constants/theme';
import { makeStyles, useTheme } from '@/hooks/useTheme';
import { QuoLogo } from '@/components/brand/QuoLogo';
import { analyticsService } from '@/services/analyticsService';

interface EmptyStateProps {
  type: 'chat' | 'conversations';
  onSuggestionPress?: (suggestion: string) => void;
  isKeyboardVisible?: boolean;
}

export function EmptyState({ type, onSuggestionPress, isKeyboardVisible }: EmptyStateProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [opacity] = useState(() => new Animated.Value(1));
  const [translateY] = useState(() => new Animated.Value(0));
  // A fresh random set of knowledge questions per empty state — complete
  // prompts that send immediately and show off what the model knows.
  const [questions] = useState(() => {
    // Lazy require: the prompt catalog is ~75KB of static data; defer
    // parsing it until the empty state actually renders.
    const { getRandomPrompts } =
      require('@/constants/suggested-prompts') as typeof import('@/constants/suggested-prompts');
    return getRandomPrompts(4);
  });

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: isKeyboardVisible ? 0 : 1,
        duration: 180,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: isKeyboardVisible ? -12 : 0,
        duration: 180,
        useNativeDriver: true,
      }),
    ]).start();
  }, [isKeyboardVisible, opacity, translateY]);

  if (type === 'conversations') {
    return (
      <View style={styles.container}>
        <View style={styles.emptyIconContainer}>
          <MessageCircle size={32} color={colors.textTertiary} strokeWidth={1.5} />
        </View>
        <Text style={styles.emptyTitle}>No conversations yet</Text>
        <Text style={styles.emptySubtitle}>
          Tap the chat tab to start your first conversation
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Faded out while the keyboard is open — and not tappable either. */}
      <Animated.View
        style={[
          styles.inner,
          { opacity, transform: [{ translateY }], pointerEvents: isKeyboardVisible ? 'none' : 'auto' },
        ]}
      >
        {/* Logo */}
        <View style={styles.logo}>
          <QuoLogo size={72} />
        </View>

        {/* Main greeting */}
        <Text style={styles.greeting}>How can I help?</Text>
        <Text style={styles.subtitle}>
          Private AI that runs entirely on your device.{'\n'}No internet needed. No account. Just you.
        </Text>

        {/* Feature badges */}
        <View style={styles.badgeRow}>
          <View style={styles.badge}>
            <WifiOff size={12} color={colors.textSecondary} />
            <Text style={styles.badgeText}>Offline</Text>
          </View>
          <View style={styles.badge}>
            <Shield size={12} color={colors.textSecondary} />
            <Text style={styles.badgeText}>Private</Text>
          </View>
          <View style={styles.badge}>
            <Zap size={12} color={colors.textSecondary} />
            <Text style={styles.badgeText}>On-Device</Text>
          </View>
        </View>

        {/* Starter questions */}
        {onSuggestionPress && (
          <View style={styles.suggestions}>
            {questions.map((question) => (
              <TouchableOpacity
                key={question}
                style={styles.suggestion}
                onPress={() => {
                  void analyticsService.track('suggested_question_tapped', {
                    question: question.slice(0, 90),
                    source: 'empty_state',
                  });
                  onSuggestionPress(question);
                }}
                activeOpacity={0.7}
              >
                <Text style={styles.suggestionText} numberOfLines={2}>{question}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </Animated.View>
    </View>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxxl,
    backgroundColor: colors.background,
  },
  inner: {
    alignItems: 'center',
  },
  logo: {
    width: 86,
    height: 86,
    marginBottom: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  greeting: {
    fontSize: 26,
    fontWeight: '600',
    color: colors.textPrimary,
    textAlign: 'center',
    letterSpacing: -0.5,
    marginBottom: spacing.sm,
  },
  subtitle: {
    fontSize: 15,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.xl,
    lineHeight: 22,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xl,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  badgeText: {
    fontSize: 13,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  suggestions: {
    width: '100%',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  suggestion: {
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    borderRadius: borderRadius.lg,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  suggestionText: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  // Conversations empty state
  emptyIconContainer: {
    width: 74,
    height: 74,
    borderRadius: borderRadius.xl,
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  emptySubtitle: {
    fontSize: 15,
    color: colors.textTertiary,
    textAlign: 'center',
  },
}));
