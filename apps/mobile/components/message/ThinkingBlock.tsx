import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { ChevronDown, ChevronUp } from 'lucide-react-native';
import { borderRadius, spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/hooks/useTheme';
import { renderContentWithMath } from '@/components/message/markdownRules';

interface ThinkingBlockProps {
  thinking: string;
  isActivelyThinking: boolean;
  shouldShowThinking: boolean;
  onToggle: () => void;
}

export function ThinkingBlock({ thinking, isActivelyThinking, shouldShowThinking, onToggle }: ThinkingBlockProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.thinkingContainer}>
      <TouchableOpacity
        style={styles.thinkingHeader}
        onPress={onToggle}
        activeOpacity={0.7}
      >
        <View style={styles.thinkingIndicator} />
        <Text style={styles.thinkingLabel}>
          {isActivelyThinking ? 'Thinking...' : 'Thought process'}
        </Text>
        {shouldShowThinking ? (
          <ChevronUp size={16} color={colors.textTertiary} />
        ) : (
          <ChevronDown size={16} color={colors.textTertiary} />
        )}
      </TouchableOpacity>
      {shouldShowThinking && (
        <View style={styles.thinkingContent}>
          {renderContentWithMath(thinking, { muted: true })}
        </View>
      )}
    </View>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  thinkingContainer: {
    marginBottom: spacing.lg,
    borderRadius: borderRadius.lg,
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    overflow: 'hidden',
  },
  thinkingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  thinkingIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.secondary,
    marginRight: spacing.sm,
  },
  thinkingLabel: {
    flex: 1,
    fontSize: 13,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  thinkingContent: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
}));
